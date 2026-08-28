import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { JobixClient, JobixError, resolveJobixEnv } from "./client";
import { buildJobixExport, type JobixRow } from "@/services/jobix-export";
import { callColumnValue, loadFlowConfig } from "@/services/flow-config";

// ---------------------------------------------------------------------------
// Writing the dialling list straight into Jobix.
//
// The write API upserts a customer on the caller's OWN identifier — the suid,
// which here is always the account number. Send a suid Jobix has not seen and
// the customer is created; send a known one and it is updated. That is what
// makes this possible at all, and it removes the paste step: the platform can
// put the book into the voice platform itself, with every field populated.
//
// SEQUENCING, and it is not incidental.
//
// The flow starts on an Insert Customer event and gates on the `call` column.
// So writing a new customer with the flag already set would fire the flow the
// instant the row lands — mid-upload, one call at a time, before the rest of
// the list exists, and with no chance to check what was written. Worse, a
// second dial can then come from the flow trigger.
//
// So it goes in two passes:
//
//   1. WRITE every customer with all fields and the batch code, and `call`
//      DELIBERATELY EMPTY. New customers fire the insert event, the filter
//      does not match, the flow exits. Nobody is called.
//   2. ARM them: a second write setting `call` to the flag. This is an update,
//      not an insert, so it does not fire the event either.
//
// Dialling then happens exactly once, when the flow is triggered — a single
// deliberate act, against a list that is already fully in place and countable.
//
// Nothing here reports a write it did not make. Every failure carries what
// Jobix actually said, and a partial push says how far it got.
// ---------------------------------------------------------------------------

export type PushFailure = { suid: string; name: string; reason: string };

/**
 * The message plus whatever Jobix said underneath it.
 *
 * "Jobix rejected the sign-in" on its own does not distinguish a wrong
 * password from a locked account, a captcha requirement or a rate limit — and
 * the provider's own words, which the error already carries, are exactly what
 * separates them. Credential-shaped text is stripped before it gets here.
 */
function describe(err: unknown): string {
  if (err instanceof JobixError) {
    return err.detail ? `${err.message} Jobix said: ${err.detail.slice(0, 300)}` : err.message;
  }
  return err instanceof Error ? err.message : "The write failed";
}

export type PushResult = {
  batchCode: string;
  /** Customers written with their fields, before arming. */
  written: number;
  /** Customers whose `call` column now carries the flag. */
  armed: number;
  /** What arms a record — null when no flag is configured and no batch code
   *  was given, in which case nothing was armed and nothing will dial. */
  callFlag: string | null;
  attempted: number;
  failures: PushFailure[];
  /** Rows found on the platform afterwards, by reading it back. */
  confirmed: number;
  /** How much of the customer list was read to confirm them. */
  scanned: number;
  /** False when the read ran out of time — confirmed is then a floor. */
  scanComplete: boolean;
  /** True when every row was written and armed. */
  complete: boolean;
  nextStep: string;
};

/** Timezone every customer is written with. The book is South African. */
const TIMEZONE = "Africa/Johannesburg";

/**
 * Wall-clock budget for reading the customer list back. Read per call rather
 * than at module load, so changing it takes effect without a restart.
 */
function confirmBudgetMs(): number {
  const configured = Number(process.env.JOBIX_CONFIRM_BUDGET_MS);
  return Number.isFinite(configured) && process.env.JOBIX_CONFIRM_BUDGET_MS ? configured : 25_000;
}

/** Last 9 digits — the stable core of a South African number in any format. */
function phoneKey(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-9);
}

/**
 * Fields the AGENT owns, which a push must never overwrite.
 *
 * The customer record holds the last call's outcome. Re-pushing a book — a
 * second run, a corrected balance, a redial — would otherwise wipe the PTP,
 * the dispute and the sentiment of every account it touches, and the platform
 * reads those back as results. So the write carries the contact fields and the
 * dialling columns, and leaves the outcome fields alone.
 */
const AGENT_OWNED = new Set([
  "Call outcome", "outcome_category", "call_summary", "debt_status", "audit_reasoning",
  "status_reason", "callback_time", "lead_status", "paymentcommit", "spoketo", "issues",
  "notpaying", "calloutcome_tag", "callbackdate", "tenantsentiment", "escalate", "paidon",
  "ptp_payment_method", "ptp_note", "arrangement_proposed", "sentiment",
  "stated_reason_for_arrears", "dispute_raised", "callback_required",
  "human_review_required", "escalation_flag", "wrong_person", "maintenance_issue_flagged",
  "spoke_to_rep", "proposed_arrangement_amount", "proposed_arrangement_day",
  "dispute_reason", "callback_date_time", "callback_assigned_to", "escalation_reason",
  "paid_already", "ptp_confirmed", "ptp_amount", "ptp_full_or_partial", "ptp_date",
]);

/** Columns that identify rather than describe — sent in `main`, not `values`. */
const IDENTITY = new Set(["SUID", "suid", "UUID", "uuid", "Timezone", "timezone"]);

function contactValues(row: JobixRow): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(row.values)) {
    if (AGENT_OWNED.has(key) || IDENTITY.has(key)) continue;
    // An empty string would blank a field Jobix already holds. Only send what
    // this push actually knows.
    if (value === "" ) continue;
    out[key] = value;
  }
  return out;
}

/**
 * The identity block.
 *
 * A customer record carries uuid, phone and name at the TOP level, with
 * everything else in its fields — which is exactly how they read back. So the
 * phone and the name belong in `main`, not only in `values`: a customer created
 * with them buried in fields has no identity for the platform's own list to
 * show, which is what "the write succeeded and nothing appeared" looked like.
 */
type Identity = { suid: string; timezone: string; phone?: string; name?: string; email?: string };

async function save(
  client: JobixClient,
  companyKey: string,
  main: Identity,
  values: Record<string, string | number>,
): Promise<Record<string, unknown>> {
  return client.postWrite<Record<string, unknown>>("/v1/customer/save", {
    company_key: companyKey,
    customer_data: { main, values },
  });
}

/**
 * Pull the provider's own customer uuid out of a save response.
 *
 * Storing it is what turns call attribution from a phone-number guess into an
 * identifier join. The response shape is not documented, so this looks in the
 * obvious places and shrugs rather than throwing if it is not there — the push
 * itself succeeded either way.
 */
function uuidFrom(response: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    response.uuid,
    response.customer_uuid,
    (response.data as Record<string, unknown> | undefined)?.uuid,
    (response.customer as Record<string, unknown> | undefined)?.uuid,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return null;
}

export async function pushDiallingList(
  organizationId: string,
  userId: string,
  options: { campaignId?: string; debtorIds?: string[]; batchCode: string },
): Promise<PushResult> {
  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");
  if (!env.companyKey) {
    throw new JobixError(
      "JOBIX_COMPANY_KEY is required to write customers. It is the workspace key the write API authorises against.",
      "not_configured",
    );
  }

  const flow = await loadFlowConfig(organizationId);
  const callFlag = callColumnValue(flow, options.batchCode) ?? null;

  const list = await buildJobixExport(organizationId, {
    campaignId: options.campaignId,
    debtorIds: options.debtorIds,
    batchCode: options.batchCode,
  });
  if (list.rowCount === 0) {
    throw new JobixError(
      "There is nothing to send — every account was excluded from the dialling list.",
      "rejected",
    );
  }

  const client = new JobixClient(env);
  const failures: PushFailure[] = [];
  const writtenRows: JobixRow[] = [];

  /**
   * A per-row failure, unless it is the kind that will repeat for every row.
   *
   * A rejected credential or an unreachable host is one problem with the
   * deployment, not five hundred problems with five hundred accounts. Listing
   * it per contact buries the actual message under its own copies, so those
   * abort the push and are reported once, with what Jobix said.
   */
  const record = (row: JobixRow, err: unknown, prefix = ""): void => {
    if (err instanceof JobixError && (err.code === "unauthorized" || err.code === "unavailable" || err.code === "not_configured")) {
      throw err;
    }
    failures.push({
      suid: row.suid,
      name: row.name,
      reason: prefix + describe(err),
    });
  };

  // --- pass 1: the customers themselves, unarmed ---------------------------
  for (const row of list.rows) {
    const values = contactValues(row);
    // Whatever the flag is, it must not go in on this pass: a new customer
    // fires the flow's insert event, and an armed row would be dialled here.
    delete values.call;
    try {
      const email = row.values.email ?? row.values.Email;
      const response = await save(
        client,
        env.companyKey,
        {
          suid: row.suid,
          timezone: TIMEZONE,
          phone: row.phone,
          name: row.name,
          ...(typeof email === "string" && email ? { email } : {}),
        },
        values,
      );
      writtenRows.push(row);
      const uuid = uuidFrom(response);
      if (uuid) {
        await db.debtor.updateMany({
          where: { id: row.debtorId, organizationId },
          data: { providerContactUuid: uuid },
        });
      }
    } catch (err) {
      record(row, err);
    }
  }

  // --- pass 2: arm what landed --------------------------------------------
  let armed = 0;
  if (callFlag) {
    for (const row of writtenRows) {
      try {
        // Arming is an update to a record that already exists, so the
        // identity does not need repeating — and repeating it would risk
        // rewriting a name or number the workspace has since corrected.
        await save(
          client,
          env.companyKey,
          { suid: row.suid, timezone: TIMEZONE },
          { batch: options.batchCode, call: callFlag },
        );
        armed += 1;
      } catch (err) {
        record(row, err, "Written, but arming failed: ");
      }
    }
  }

  await db.debtor.updateMany({
    where: { id: { in: writtenRows.map((row) => row.debtorId) }, organizationId },
    data: { callBatch: options.batchCode },
  });

  // --- read it back -------------------------------------------------------
  //
  // A 200 from a write is not the same fact as a customer existing. This push
  // once reported two customers written and armed while nothing appeared in the
  // platform's own list, because the identity was in the wrong part of the
  // payload — and every count it printed was about its own requests. So the
  // list is read and the rows are looked for, on the suid the write upserts on,
  // with a phone fallback for a workspace that does not return one.
  let confirmed = 0;
  let scanned = 0;
  let scanComplete = true;
  if (writtenRows.length > 0) {
    const deadline = Date.now() + confirmBudgetMs();
    try {
      const { pullCustomers } = await import("./api");
      const { customers } = await pullCustomers(client, {
        onPage: () => {
          if (Date.now() > deadline) {
            scanComplete = false;
            return false;
          }
        },
      });
      scanned = customers.length;
      const suids = new Set(customers.map((c) => c.suid).filter(Boolean));
      const phones = new Set(customers.map((c) => phoneKey(c.phone)).filter(Boolean));
      confirmed = writtenRows.filter(
        (row) => suids.has(row.suid) || phones.has(phoneKey(row.phone)),
      ).length;
    } catch {
      // The confirmation is best effort: a read that fails does not unwrite
      // anything, so the counts above still stand and this is reported as
      // unverified rather than as a failure.
      scanComplete = false;
    }
  }

  const complete = failures.length === 0 && armed === list.rowCount && confirmed === list.rowCount;
  const missing = writtenRows.length - confirmed;
  const nextStep = !callFlag
    ? `${writtenRows.length} customers are in Jobix, but nothing is armed: no call flag is configured, so the flow's filter will match nobody. Set one under Settings.`
    : complete
      ? `${armed} customers written, armed with ${callFlag}, and confirmed present on the platform. Start the calls — the flow dials exactly these.`
      : failures.length > 0
        ? `${writtenRows.length} of ${list.rowCount} written, ${armed} armed. Fix the failures below before starting, or start and dial only what is armed.`
        : !scanComplete
          ? `${armed} written and armed. Reading the platform back found ${confirmed} of them in ${scanned} records before running out of time, so treat that as a floor rather than a total — check the customer list in Jobix.`
          : `${armed} written and armed, but only ${confirmed} of ${writtenRows.length} could be found in the platform's ${scanned} customer records${missing > 0 ? ` — ${missing} did not land` : ""}. The write was accepted and the customer is not there, so do not start the calls yet.`;

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.customers_pushed",
    entityType: "call_batch",
    entityId: options.batchCode,
    detail: {
      campaignId: options.campaignId ?? null,
      attempted: list.rowCount,
      written: writtenRows.length,
      armed,
      confirmed,
      scanned,
      callFlag,
      failed: failures.length,
    },
  });

  return {
    batchCode: options.batchCode,
    written: writtenRows.length,
    armed,
    confirmed,
    scanned,
    scanComplete,
    callFlag,
    attempted: list.rowCount,
    failures: failures.slice(0, 50),
    complete,
    nextStep,
  };
}
