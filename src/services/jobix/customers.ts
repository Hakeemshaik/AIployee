import { db } from "@/lib/db";
import type { JobixCustomer } from "./api";

// ---------------------------------------------------------------------------
// Persisting pulled customer records.
//
// Until this existed, ingestion pulled customers, filtered and deduped them,
// reported a count — and wrote nothing. Two consequences: a book that already
// lives in Jobix could not be brought into the platform, and the outcome
// fields on Jobix customer records (PTP confirmed, disputed, paid-claimed)
// never arrived, so live analytics showed R0 committed after a successful
// ingestion. This closes that pipe.
//
// Ground rules:
//
//  * The join key is the PHONE NUMBER, because it is the only key Jobix
//    reliably puts on a customer. A record whose phone cannot be normalised is
//    skipped and counted, never guessed at.
//  * The provider can escalate a debtor's state but never quietly walk it
//    back: do-not-contact is set from the provider, not unset, and a status a
//    human chose (legal, hardship) is not overwritten by a flag sync.
//  * A confirmed PTP becomes a real PromiseToPay row so the promises screen,
//    the work queue and the commitments range all see it. Jobix rarely states
//    a promise DATE; rather than invent one, the record's own modification
//    time is used and the row is marked dateStated:false so nothing downstream
//    mistakes it for a debtor-chosen date.
// ---------------------------------------------------------------------------

export type CustomerSyncResult = {
  created: number;
  updated: number;
  skippedNoPhone: number;
  promisesCreated: number;
  promisesUpdated: number;
};

/** Last 9 digits — the stable core of a South African number in any format. */
function phoneKey(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export function splitName(name: string | null, phone: string): { firstName: string; lastName: string } {
  const cleaned = (name ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) {
    // No name on the provider record. The phone tail keeps rows tellable-apart
    // in lists without pretending to know who this is.
    return { firstName: "Unknown", lastName: `(${phone.slice(-4)})` };
  }
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Statuses a human set that a provider flag sync must never overwrite.
 * Everything else ("active", "promise", "uncontactable"…) is fair game.
 */
const HUMAN_OWNED_STATUSES = new Set(["legal", "hardship", "opted_out"]);

export function nextStatus(current: string, c: JobixCustomer): string {
  if (HUMAN_OWNED_STATUSES.has(current)) return current;
  if (c.escalated) return "escalated";
  if (c.disputed) return "dispute";
  if (c.paidClaimed) return "paid";
  if (c.ptpConfirmed) return "promise";
  return current;
}

/** A promise date the provider actually stated, when one exists in the raw fields. */
export function statedPtpDate(raw: Record<string, unknown>): Date | null {
  for (const key of ["ptp_date", "promise_date", "payment_date"]) {
    const value = raw[key];
    const text =
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "value" in value
          ? String((value as { value: unknown }).value ?? "")
          : "";
    if (!text || text.startsWith("{{") || text === "No data available") continue;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export async function persistCustomers(
  organizationId: string,
  customers: JobixCustomer[],
): Promise<CustomerSyncResult> {
  const result: CustomerSyncResult = {
    created: 0,
    updated: 0,
    skippedNoPhone: 0,
    promisesCreated: 0,
    promisesUpdated: 0,
  };

  // One read for the whole batch: existing debtors keyed by normalised phone.
  const existing = await db.debtor.findMany({
    where: { organizationId },
    select: { id: true, phone: true, status: true, doNotContact: true },
  });
  const byPhone = new Map<string, (typeof existing)[number]>();
  for (const debtor of existing) {
    const key = phoneKey(debtor.phone);
    if (key) byPhone.set(key, debtor);
  }

  for (const customer of customers) {
    const key = phoneKey(customer.phone);
    if (!key) {
      result.skippedNoPhone += 1;
      continue;
    }

    const match = byPhone.get(key);
    let debtorId: string;

    if (match) {
      await db.debtor.update({
        where: { id: match.id },
        data: {
          status: nextStatus(match.status, customer),
          // Set, never unset: clearing a DNC flag needs a human decision.
          ...(customer.doNotCall ? { doNotContact: true } : {}),
          ...(customer.modifiedAt ? { lastContactAt: customer.modifiedAt } : {}),
          // The provider's own identifiers: its customer uuid, which its
          // conversation records reference, and the batch code sitting in the
          // record's `call` field. Together they let a campaign's calls be
          // recognised from the record instead of inferred from a number.
          providerContactUuid: customer.uuid,
          ...(customer.callBatch ? { callBatch: customer.callBatch } : {}),
        },
      });
      debtorId = match.id;
      result.updated += 1;
    } else {
      const { firstName, lastName } = splitName(customer.name, customer.phone);
      const created = await db.debtor.create({
        data: {
          organizationId,
          firstName,
          lastName,
          // Jobix's uuid is the only stable identifier it gives us; prefixed so
          // it is recognisable as provider-issued, not a ledger number.
          accountNumber: `JBX-${customer.uuid}`,
          phone: customer.phone,
          status: nextStatus("active", customer),
          doNotContact: customer.doNotCall,
          lastContactAt: customer.modifiedAt ?? undefined,
          providerContactUuid: customer.uuid,
          callBatch: customer.callBatch,
        },
      });
      if (customer.totalDue !== null && customer.totalDue > 0) {
        await db.debtAccount.create({
          data: {
            organizationId,
            debtorId: created.id,
            creditorName: customer.building ?? "Imported from voice platform",
            reference: customer.unit ?? customer.uuid,
            originalBalance: customer.totalDue,
            currentBalance: customer.totalDue,
            // Jobix does not carry a due date; the record's own modification
            // time is the closest honest anchor for ageing.
            dueDate: customer.modifiedAt ?? new Date(),
          },
        });
      }
      byPhone.set(key, { id: created.id, phone: created.phone, status: created.status, doNotContact: created.doNotContact });
      debtorId = created.id;
      result.created += 1;
    }

    // --- confirmed PTP → a real promise row ---
    if (customer.ptpConfirmed) {
      const open = await db.promiseToPay.findFirst({
        where: { organizationId, debtorId, status: "pending" },
      });
      const stated = statedPtpDate(customer.raw);
      if (open) {
        // Only the amount is refreshed, and only when the provider states one —
        // a promise a human already edited keeps its date and plan.
        if (customer.ptpAmount && customer.ptpAmount > 0 && open.amount !== customer.ptpAmount) {
          await db.promiseToPay.update({ where: { id: open.id }, data: { amount: customer.ptpAmount } });
          result.promisesUpdated += 1;
        }
      } else {
        await db.promiseToPay.create({
          data: {
            organizationId,
            debtorId,
            // No stated amount → 0, which the analytics engine already treats
            // as "floor 0, ceiling = full balance". Never substitute the balance
            // here: that would silently turn the ceiling into the floor.
            amount: customer.ptpAmount && customer.ptpAmount > 0 ? customer.ptpAmount : 0,
            promisedDate: stated ?? customer.modifiedAt ?? new Date(),
            paymentPlan: JSON.stringify({
              source: "jobix_customer_sync",
              dateStated: stated !== null,
              amountStated: !!(customer.ptpAmount && customer.ptpAmount > 0),
            }),
          },
        });
        result.promisesCreated += 1;
      }
    }
  }

  return result;
}
