import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildStamp } from "@/lib/build-info";
import { JobixClient, JobixError, resolveJobixEnv } from "./client";
import { loadFlowConfig } from "@/services/flow-config";
import { checkCallingWindow, denyList } from "./calling";
import { plainWireName } from "@/services/jobix-export";

// ---------------------------------------------------------------------------
// One submit, one insert, one call.
//
// This is the whole Speed to Lead mechanism, and nothing else. That form takes a
// name, a number and a flag, mints a reference, writes ONE customer, and the
// flow's Insert Customer event does the rest — there is no batch, no list, no
// second pass and no start button. Its own field definition says exactly where
// each value goes:
//
//   name      → main.name, mirrored to values.full_name
//   phone     → main.phone, and NOT mirrored into values
//   timezone  → main.timezone
//   call      → values.call     (the value the flow's entry filter matches)
//   email     → values.email
//   suid      → main.suid, "the id we minted"  — a fresh uuid per submit
//
// A campaign send is the same write repeated with a budget, a resume and a
// read-back around it. All of that machinery is worth having for a book of two
// thousand and is in the way when the question is "does one call work at all",
// so this path exists on its own: one request, and the platform's own answer
// reported verbatim.
// ---------------------------------------------------------------------------

export type DialOneResult = {
  /** The reference this submit minted, which is how the record is found. */
  suid: string;
  /** The attempt row this created, which is what the result panel watches. */
  attemptId: string;
  name: string;
  phone: string;
  /** The value written to the call column — what the flow's filter must match. */
  callFlag: string;
  /** Exactly what was sent, minus the credential. */
  sent: unknown;
  /** Exactly what came back. */
  received: unknown;
  /** Which build and which payload revision wrote it. */
  build: string;
  /** What to expect, in words. */
  nextStep: string;
};

/** A number the platform will dial: E.164, and not on the deny list. */
function checkNumber(phone: string): string {
  const trimmed = phone.trim().replace(/\s+/g, "");
  if (!/^\+\d{8,15}$/.test(trimmed)) {
    throw new JobixError(
      `"${phone}" is not a number the platform can dial. Write it in full international form, e.g. +27825551234.`,
      "rejected",
    );
  }
  const digits = trimmed.replace(/\D/g, "");
  for (const denied of denyList()) {
    if (digits.endsWith(denied.replace(/\D/g, "").slice(-9))) {
      throw new JobixError(
        "That number is on the deny list for this deployment and will never be dialled.",
        "rejected",
      );
    }
  }
  return trimmed;
}

/**
 * Submit one customer and let the flow call them.
 *
 * `debtorId` dials an account from the book, with the book's own guardrails
 * applied. Without one it dials the name and number given — the equivalent of
 * filling the form in by hand, which is how a person checks their own phone
 * rings.
 */
export async function dialOne(
  organizationId: string,
  userId: string,
  input: { debtorId?: string; name?: string; phone?: string; email?: string },
): Promise<DialOneResult> {
  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");
  if (!env.companyKey) {
    throw new JobixError(
      "The write API key is required to write a customer. Set it under Settings.",
      "not_configured",
    );
  }

  // The same two gates a campaign send passes, because this dials a real phone
  // exactly as a send does.
  if (process.env.JOBIX_CALLING_ENABLED !== "true") {
    throw new JobixError(
      "Dialling from this platform is switched off. Set JOBIX_CALLING_ENABLED=true on the deployment and redeploy.",
      "rejected",
    );
  }
  const window = checkCallingWindow();
  if (!window.allowed) {
    throw new JobixError(
      `${window.reason} The call happens the moment the customer is written, so it cannot be sent outside calling hours.`,
      "rejected",
    );
  }

  const flow = await loadFlowConfig(organizationId);
  // A fixed flag or nothing: a per-run batch code is meaningless for a single
  // submit, and writing one the flow's filter does not name would report a call
  // that never happens.
  const callFlag = flow.callFlag?.trim();
  if (!callFlag) {
    throw new JobixError(
      "No call flag is configured, so nothing would arm this record. Set it under Settings to the word your flow's entry filter looks for.",
      "not_configured",
    );
  }

  let name: string;
  let phone: string;
  let email: string | undefined;
  let debtorId: string | undefined;
  let campaignId: string | undefined;

  if (input.debtorId) {
    const debtor = await db.debtor.findFirst({
      where: { id: input.debtorId, organizationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        campaignId: true,
        doNotContact: true,
        promises: { where: { status: "pending" }, select: { id: true } },
      },
    });
    if (!debtor) throw new JobixError("That account is not in this organization's book.", "rejected");
    campaignId = debtor.campaignId ?? undefined;
    // The book's rules, one account at a time. A single-account path that
    // skipped them would be the way every guardrail gets bypassed.
    if (debtor.doNotContact) {
      throw new JobixError("This account is flagged do-not-contact.", "rejected");
    }
    if (["dispute", "escalated", "paid", "opted_out", "legal", "hardship"].includes(debtor.status)) {
      throw new JobixError(
        `This account's status is "${debtor.status.replace(/_/g, " ")}", which is never dialled.`,
        "rejected",
      );
    }
    if (debtor.promises.length > 0) {
      throw new JobixError(
        "This account has a live promise to pay. Chasing it before the promised date is what breaks promises.",
        "rejected",
      );
    }
    debtorId = debtor.id;
    name = plainWireName(`${debtor.firstName} ${debtor.lastName}`);
    phone = checkNumber(debtor.phone);
    email = debtor.email ?? undefined;
  } else {
    if (!input.name?.trim() || !input.phone?.trim()) {
      throw new JobixError("A name and a number are needed to place a call.", "rejected");
    }
    name = plainWireName(input.name);
    phone = checkNumber(input.phone);
    email = input.email?.trim() || undefined;
  }

  // The payload, in the shape the form's own definition sets out.
  const suid = randomUUID();
  const main = { suid, timezone: "Africa/Johannesburg", phone, name };
  const values: Record<string, string | number> = {
    full_name: name,
    call: callFlag,
    // Both columns carry the flag on every dial this workspace has made.
    all: callFlag,
    ...(email ? { email } : {}),
  };

  const client = new JobixClient(env);
  const received = await client.postWrite<Record<string, unknown>>("/v1/customer/save", {
    company_key: env.companyKey,
    customer_data: { main, values },
  });

  // The write IS the call, so the attempt is recorded the moment it lands.
  // Without this there is nothing between pressing the button and a result
  // arriving — no evidence anybody was rung, and no way to tell a call still
  // running from one that never happened. The suid is the join: the platform
  // hands it back on the outcome, and the transcript, the promise and the
  // recording all find their way here through it.
  const attempt = await db.dialAttempt.create({
    data: {
      organizationId,
      suid,
      debtorId: debtorId ?? null,
      campaignId: campaignId ?? null,
      name,
      phone,
      callFlag,
      requestedById: userId,
      state: "placed",
    },
  });

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.dialled_one",
    entityType: debtorId ? "debtor" : "call_batch",
    entityId: debtorId ?? suid,
    detail: { suid, attemptId: attempt.id, phone, callFlag, response: received },
  });

  return {
    suid,
    attemptId: attempt.id,
    name,
    phone,
    callFlag,
    // The credential never leaves the server.
    sent: { company_key: "[redacted]", customer_data: { main, values } },
    received,
    build: buildStamp(),
    nextStep:
      `Written as one customer with ${callFlag} in the call column. The flow starts on a customer being ` +
      `written, so if its entry filter names ${callFlag}, ${phone} rings within a minute or two — there is ` +
      `nothing further to press. If it does not, the record is in Jobix under reference ${suid}: find it in ` +
      `the customer list and the flow's run history will say why it did not act on it.`,
  };
}
