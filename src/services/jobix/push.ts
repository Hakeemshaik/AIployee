import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { buildStamp } from "@/lib/build-info";
import { audit } from "@/lib/audit";
import { JobixClient, JobixError, resolveJobixEnv } from "./client";
import { buildJobixExport, plainWireName, type JobixRow } from "@/services/jobix-export";
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
// WHAT A DIAL IS, on an insert-started flow: a NEW customer record.
//
// Taken from the live submissions of a form that does dial, not from
// inference. Every one of them writes a FRESH suid — a value that has never
// been seen before — with the flag already in `values`, and gets back
// {queued: true}. Repeat calls to the same person are repeat records: same
// name, same number, a new suid each time.
//
// That is not incidental, it is the mechanism. The flow's entry is an Insert
// Customer event, so only an INSERT starts it. Reuse a stable key like the
// account number and the second run is an update, which fires nothing — the
// platform writes, reports success, and no phone rings. So on this kind of
// flow the suid is unique per run (account number plus the batch code, so it
// stays readable and traceable), and two records for one number are the
// expected shape rather than damage to prevent.
//
// SEQUENCING, which depends entirely on how the flow begins.
//
// A flow whose entry is an Insert Customer event fires when a customer is
// WRITTEN. Nothing else starts it: arming a customer that already exists is an
// update, and an update raises no event. So for that flow the customer must be
// written with the flag already in place — one write, and the call happens.
// This is how a form gets an immediate call-back: it submits one customer, and
// that insert IS the trigger.
//
// A flow driven by its Run node is the opposite. There, customers can be
// written unarmed, armed in a second pass, and dialled only when a person fires
// the node — which keeps a large upload from ringing phones as rows land.
//
// Writing for the wrong one is silent: the platform writes, reports success,
// and no phone ever rings. So it is a setting, not a guess, and the mode
// decides whether a single armed write or two passes happen here.
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
  /** New customers on the platform. */
  created: number;
  /** Existing customers matched by their suid and updated. */
  updated: number;
  /** Existing customers that had no suid — matched by number and written
   *  against the provider's own id so the record was not duplicated. */
  relinked: number;
  /** Numbers that went from one record to two: a relink that did not land. */
  duplicated: number;
  /** Rows the budget did not reach. Nothing was sent for them, so nobody on
   *  this list has been called. */
  unsent: number;
  /** Rows found on the platform afterwards, by reading it back. */
  confirmed: number;
  /** How much of the customer list was read to confirm them. */
  scanned: number;
  /** False when the read ran out of time — confirmed is then a floor. */
  scanComplete: boolean;
  /** The platform's customer list carries no reference, so a write cannot be
   *  confirmed either way — reported as unverified, never as success. */
  referenceless: boolean;
  /** True when the call column carries the configured flag rather than this
   *  run's code standing in for one. */
  flagIsFixed: boolean;
  /** True when the write itself started the flow, so calls are already going
   *  out and no separate start is needed. */
  dialledOnWrite: boolean;
  /** True when every row was written, armed with a usable flag, and found. */
  complete: boolean;
  nextStep: string;
  /** Which build wrote this batch, and which revision of the payload. */
  build: string;
};

/** Timezone every customer is written with. The book is South African. */
const TIMEZONE = "Africa/Johannesburg";

/**
 * How many customers are written at once.
 *
 * One at a time is roughly a quarter-second each: fine for a test call, about
 * eleven minutes for a book of two and a half thousand — past any request
 * ceiling. Bounded rather than unbounded, because the workspace on the other
 * end is a live dialler and not a load target.
 */
function writeConcurrency(): number {
  const configured = Number(process.env.JOBIX_WRITE_CONCURRENCY);
  return Number.isFinite(configured) && configured > 0 ? configured : 8;
}

/**
 * Wall-clock budget for the writing itself, kept under the request ceiling.
 *
 * Stopping on purpose reports how far it got and can be continued. Being killed
 * mid-loop leaves an unknown number of people called and nothing to resume
 * from, which on an insert-started flow means not knowing who has been dialled.
 */
function writeBudgetMs(): number {
  const configured = Number(process.env.JOBIX_WRITE_BUDGET_MS);
  return Number.isFinite(configured) && process.env.JOBIX_WRITE_BUDGET_MS ? configured : 240_000;
}

/**
 * Wall-clock budget for reading the customer list back. Read per call rather
 * than at module load, so changing it takes effect without a restart.
 */
function confirmBudgetMs(): number {
  const configured = Number(process.env.JOBIX_CONFIRM_BUDGET_MS);
  // 25 seconds did not get through 1500 customers, so every confirmation on a
  // real workspace came back "ran out of time" — a check that cannot finish is
  // not a check. The route allows 300s; this takes a third of it.
  return Number.isFinite(configured) && process.env.JOBIX_CONFIRM_BUDGET_MS ? configured : 90_000;
}

/**
 * How long to wait before re-reading, when a written row is not in the list yet.
 *
 * The write API queues: a success means accepted for processing, so a row can be
 * genuinely on its way and genuinely absent from a read taken immediately
 * afterwards. One short wait separates "still queued" from "never landed".
 */
const QUEUE_SETTLE_MS = Number(process.env.JOBIX_QUEUE_SETTLE_MS ?? 4000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A reference the write API will accept.
 *
 * The known-good payloads carry a bare uuid — letters, digits and dashes and
 * nothing else. A key built by joining an account number to a batch code with a
 * colon is a shape no working write has ever used, and a write whose only
 * failure mode is being accepted and discarded is not the place to find out
 * whether punctuation matters. Letters, digits and dashes only.
 */
function safeSuid(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(0, 120) || "unnamed";
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

/**
 * The fields a working write actually carries.
 *
 * Taken from submissions the platform accepted AND kept. They are few: a name,
 * a number, an email, what is owed, where they live, and the dialling columns.
 *
 * This used to send everything the paste template has a column for — around
 * fifty keys per customer, most of them the agent's own output fields left
 * blank. A queue that validates its input has fifty chances to reject that and
 * only one way to tell you: accepting the write and discarding the row. So the
 * payload is now the known-good set and nothing else.
 */
const SENT_FIELDS = new Set([
  // Exactly the fields a dial this workspace has actually made carries:
  // full_name, email, total_due, unit_number, building_name, and the flag in
  // both `call` and `all`.
  "full_name",
  "email",
  "total_due",
  "unit_number",
  "building_name",
  // Attribution. Both are columns of the workspace's own import template, and
  // without them a result cannot be tied back to an account or a run.
  "tenant_code",
  "batch",
  // The flag the flow's entry filter matches on, in both spellings a working
  // dial uses.
  "call", "all",
  // Deliberately not sent, though the import template has a column for each:
  // name, Name, Phone, Email, arrears_amount, main_unit_no, location,
  // language, month-of. A queue that validates its input has one way to
  // refuse a key it does not want — accept the write and drop the row — and
  // that is exactly the failure being chased. The number and the name are
  // identity and travel in `main`. The rest are script niceties, and none of
  // them is needed to place a call; they go back in once a dial has landed.
]);

function contactValues(row: JobixRow): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(row.values)) {
    if (!SENT_FIELDS.has(key)) continue;
    if (AGENT_OWNED.has(key) || IDENTITY.has(key)) continue;
    // An empty string would blank a field Jobix already holds. Only send what
    // this push actually knows.
    if (value === "") continue;
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
export type Identity = {
  suid: string;
  timezone: string;
  /** The provider's own customer id, sent when this record already exists
   *  under a different key so the write lands on it instead of making a
   *  second one. */
  uuid?: string;
  phone?: string;
  name?: string;
  email?: string;
};

type ExistingCustomer = {
  uuid: string;
  suid: string | null;
  phone: string;
  /** The batch a record belongs to, needed to disarm exactly one run. */
  batch?: string | null;
};

/**
 * The workspace's customers, within a wall-clock budget.
 *
 * Bounded because this cannot always finish inside a request on a large book,
 * and an unfinished read has to be reported as unfinished rather than as an
 * empty platform — treating a truncated scan as "nobody is there" would create
 * a duplicate for every account it did not reach.
 */
async function readCustomers(
  client: JobixClient,
  options: { withBatch?: boolean } = {},
): Promise<{ customers: ExistingCustomer[]; complete: boolean }> {
  const deadline = Date.now() + confirmBudgetMs();
  let complete = true;
  try {
    const { pullCustomers } = await import("./api");
    const { customers } = await pullCustomers(client, {
      onPage: () => {
        if (Date.now() > deadline) {
          complete = false;
          return false;
        }
      },
    });
    return {
      customers: customers.map((customer) => ({
        uuid: customer.uuid,
        suid: customer.suid,
        phone: customer.phone,
        ...(options.withBatch ? { batch: customer.callBatch } : {}),
      })),
      complete,
    };
  } catch {
    // A read that fails does not unwrite anything and must not be mistaken for
    // an empty workspace.
    return { customers: [], complete: false };
  }
}

/**
 * The one write everything goes through — the campaign send, the single dial,
 * the probes, and the Campaign Engine's drip. Exported so no second component
 * ever reconstructs the payload shape and drifts from it.
 */
export async function save(
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
 * Usually there is none: a successful save answers {queued: true, saveInitTime}
 * and no identifier at all. The uuid is learned from reading the customer list
 * afterwards instead. This stays because a response that does carry one is
 * worth using, and it returns null rather than throwing when it does not.
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
  options: {
    campaignId?: string;
    debtorIds?: string[];
    batchCode: string;
    /**
     * Continue a batch a previous run did not finish: rows already carrying
     * this batch code are skipped. Without it a resumed send would write every
     * row again, which on an insert-started flow calls everyone a second time.
     */
    skipAlreadySent?: boolean;
  },
): Promise<PushResult> {
  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");
  if (!env.companyKey) {
    throw new JobixError(
      "JOBIX_COMPANY_KEY is required to write customers. It is the workspace key the write API authorises against.",
      "not_configured",
    );
  }

  // Captured once: narrowing from the guard above does not survive into the
  // closures below.
  const companyKey = env.companyKey;

  const flow = await loadFlowConfig(organizationId);
  const callFlag = callColumnValue(flow, options.batchCode) ?? null;
  // Whether that value is the CONFIGURED flag or this run's code standing in
  // for one. The difference decides whether the flow's filter can match: a
  // filter reads a fixed value, so a per-run code matches nothing until
  // somebody edits the flow. Reporting that as "armed" is how a run ends with
  // nobody called and no error anywhere.
  const flagIsFixed = !!flow.callFlag;
  // On an insert-started flow the flag has to be in the FIRST write, because
  // that write is what starts the flow. Anywhere else and it never dials.
  const armOnWrite = flow.flowStart === "insert";

  /**
   * The key this run writes under.
   *
   * On an insert-started flow it is a fresh uuid per row, because only an
   * insert starts the flow and a reused key is an update — and because a plain
   * uuid is what every dial this workspace has actually made was keyed on. A
   * readable key built from the account number was tried and the platform
   * accepted those writes and kept none of them.
   *
   * The account is still findable on the record: the account number rides in
   * `tenant_code` and the run's code in `batch`, which is what results are
   * matched on afterwards.
   *
   * Memoised, so the confirmation read below looks for the same key the write
   * used. Otherwise every row would be reported missing.
   */
  const runSuids = new Map<string, string>();
  const suidFor = (row: JobixRow) => {
    if (!armOnWrite) return safeSuid(row.suid);
    const existing = runSuids.get(row.debtorId);
    if (existing) return existing;
    const fresh = randomUUID();
    runSuids.set(row.debtorId, fresh);
    return fresh;
  };

  const list = await buildJobixExport(organizationId, {
    campaignId: options.campaignId,
    debtorIds: options.debtorIds,
    batchCode: options.batchCode,
  });
  // Drop what a previous, unfinished run already sent under this code.
  let alreadySent = 0;
  if (options.skipAlreadySent) {
    const sent = new Set(
      (
        await db.debtor.findMany({
          where: { organizationId, callBatch: options.batchCode },
          select: { id: true },
        })
      ).map((debtor) => debtor.id),
    );
    alreadySent = list.rows.filter((row) => sent.has(row.debtorId)).length;
    list.rows = list.rows.filter((row) => !sent.has(row.debtorId));
    list.rowCount = list.rows.length;
  }
  if (list.rowCount === 0) {
    throw new JobixError(
      alreadySent > 0
        ? `Every account in this batch has already been sent (${alreadySent}). Nothing was sent again, so nobody was called twice.`
        : "There is nothing to send — every account was excluded from the dialling list.",
      "rejected",
    );
  }

  const client = new JobixClient(env);
  const failures: PushFailure[] = [];
  const writtenRows: JobixRow[] = [];

  // --- who is already there ------------------------------------------------
  //
  // The write upserts on the suid, and customers put on the platform by a
  // pasted file have NO suid — that column is empty in the import template. So
  // a push keyed only on suid does not update those people, it creates a second
  // record for each of them: the account looks untouched while a duplicate
  // appears elsewhere in the list.
  //
  // Reading first makes the difference visible. A record found by suid is an
  // ordinary update. One found only by phone already exists under a different
  // key, and the write carries the provider's own customer id so it lands on
  // that record and stamps the suid onto it — after which it matches by suid
  // like everything else.
  // Matching only matters when the write is an update. On an insert-started
  // flow every row is deliberately a new record, so there is nothing to match
  // and nothing to read first — which also removes a refusal that would
  // otherwise block a big book for a scan it does not need.
  const before = armOnWrite
    ? { customers: [] as ExistingCustomer[], complete: true }
    : await readCustomers(client);
  if (!before.complete) {
    // Refusing is the conservative direction. A partial list means an account
    // that IS on the platform may not have been seen, and writing it then
    // creates a second record for a real person — damage in their live
    // dialling data, to save a wait.
    throw new JobixError(
      `The platform's customer list could not be read in full (${before.customers.length} records read), so this push cannot tell which of these accounts are already there. Writing them now risks creating a duplicate for anyone it missed. Raise JOBIX_CONFIRM_BUDGET_MS and try again.`,
      "rejected",
    );
  }
  const bySuid = new Map<string, ExistingCustomer>();
  const byPhone = new Map<string, ExistingCustomer>();
  for (const customer of before.customers) {
    if (customer.suid) bySuid.set(customer.suid, customer);
    const key = phoneKey(customer.phone);
    if (key && !byPhone.has(key)) byPhone.set(key, customer);
  }

  let created = 0;
  let updated = 0;
  let relinked = 0;

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

  // --- pass 1: the customers themselves ------------------------------------
  //
  // Concurrent and budgeted. Sequential writing cannot finish a book inside a
  // request, and being killed part-way through is the worst outcome available
  // on an insert-started flow: some unknown number of people have been called
  // and nothing records which. So it stops itself before that, having marked
  // every row it completed.
  const writeDeadline = Date.now() + writeBudgetMs();
  const queue = [...list.rows];

  const writeOne = async (row: JobixRow): Promise<void> => {
    const values = contactValues(row);
    if (armOnWrite && callFlag) {
      // This write is the trigger. The flag goes in now or the flow never runs.
      values.call = callFlag;
      // A working dial on this workspace carries the same value in `all` as in
      // `call`. Which of the two the flow's filter reads is not visible from
      // here, and setting both costs nothing.
      values.all = callFlag;
    } else {
      // Held back deliberately: on a trigger-started flow nobody should be
      // dialled until a person fires the node.
      delete values.call;
      delete values.all;
    }
    const known = bySuid.get(row.suid);
    const samePhone = known ? null : byPhone.get(phoneKey(row.phone)) ?? null;
    const response = await save(
      client,
      companyKey,
      {
        suid: suidFor(row),
        timezone: TIMEZONE,
        // Only when this record exists under another key. Sending it
        // otherwise would name a customer that does not exist yet.
        ...(samePhone ? { uuid: samePhone.uuid } : {}),
        phone: row.phone,
        name: row.name,
      },
      values,
    );
    if (armOnWrite) created += 1;
    else if (known) updated += 1;
    else if (samePhone) relinked += 1;
    else created += 1;
    writtenRows.push(row);
    // Recorded as each row lands, not at the end: this is what says who has
    // already been sent for this batch if the budget runs out.
    await db.debtor.updateMany({
      where: { id: row.debtorId, organizationId },
      data: {
        callBatch: options.batchCode,
        ...(uuidFrom(response) ? { providerContactUuid: uuidFrom(response)! } : {}),
      },
    });
  };

  // A fatal failure has to stop the OTHER workers too. Without this they carry
  // on writing after the push has already thrown — and on an insert-started
  // flow that means calls still going out after the operator was told the push
  // failed.
  let fatal: unknown = null;

  const worker = async () => {
    for (;;) {
      if (fatal) return;
      // Whatever is left in the queue when the workers stop is what was not
      // sent, which is the number reported.
      if (Date.now() > writeDeadline) return;
      const row = queue.shift();
      if (!row) return;
      try {
        await writeOne(row);
      } catch (err) {
        try {
          record(row, err);
        } catch (stop) {
          // record() rethrows the failures that will repeat for every row.
          fatal = stop;
          return;
        }
      }
    }
  };
  // allSettled, so every worker has actually finished before the throw below:
  // Promise.all would reject while the others were still mid-write.
  await Promise.allSettled(
    Array.from({ length: Math.max(1, Math.min(writeConcurrency(), list.rows.length)) }, worker),
  );
  if (fatal) throw fatal;
  const unsent = queue.length;

  // --- pass 2: arm what landed --------------------------------------------
  //
  // Skipped when the first write already carried the flag: a second write would
  // be an update to a customer the flow is already calling.
  let armed = armOnWrite && callFlag ? writtenRows.length : 0;
  if (callFlag && !armOnWrite) {
    for (const row of writtenRows) {
      try {
        // Arming is an update to a record that already exists, so the
        // identity does not need repeating — and repeating it would risk
        // rewriting a name or number the workspace has since corrected.
        await save(
          client,
          companyKey,
          { suid: suidFor(row), timezone: TIMEZONE },
          { batch: options.batchCode, call: callFlag, all: callFlag },
        );
        armed += 1;
      } catch (err) {
        record(row, err, "Written, but arming failed: ");
      }
    }
  }

  // --- read it back -------------------------------------------------------
  //
  // A 200 from a write is not the same fact as a customer existing. This push
  // once reported two customers written and armed while nothing appeared in the
  // platform's own list, because the identity was in the wrong part of the
  // payload — and every count it printed was about its own requests. So the
  // list is read and the rows are looked for, on the suid the write upserts on,
  // with a phone fallback for a workspace that does not return one.
  let confirmed = 0;
  let scanned = before.customers.length;
  let scanComplete: boolean = before.complete;
  let duplicated = 0;
  let referenceless = false;
  if (writtenRows.length > 0) {
    let after = await readCustomers(client);
    scanned = after.customers.length;
    scanComplete = after.complete;
    const index = (customers: ExistingCustomer[]) => {
      const uuidBySuid = new Map<string, string>();
      for (const customer of customers) {
        if (customer.suid) uuidBySuid.set(customer.suid, customer.uuid);
      }
      return uuidBySuid;
    };
    let uuidBySuid = index(after.customers);

    // A save answers {queued: true} — accepted for processing, not created. So
    // a row missing from the first read may simply not have been processed yet.
    // One short wait and one more read, before concluding it never landed.
    if (writtenRows.some((row) => !uuidBySuid.has(suidFor(row)))) {
      await sleep(QUEUE_SETTLE_MS);
      const settled = await readCustomers(client);
      if (settled.complete || settled.customers.length > after.customers.length) {
        after = settled;
        scanned = settled.customers.length;
        scanComplete = settled.complete;
        uuidBySuid = index(settled.customers);
      }
    }

    const phones = new Map<string, number>();
    for (const customer of after.customers) {
      const key = phoneKey(customer.phone);
      if (key) phones.set(key, (phones.get(key) ?? 0) + 1);
    }

    // Matched ONLY on the reference this run wrote.
    //
    // There used to be a phone fallback here, and it made this check
    // meaningless: any number already on the platform — from an earlier run, a
    // pasted file, a form — satisfied it, so the push reported "confirmed
    // present" for a customer it had not created. Confirming a write by
    // finding somebody else's record is not confirming anything.
    confirmed = writtenRows.filter((row) => uuidBySuid.has(suidFor(row))).length;
    // If the list exposes no reference at all, nothing can be confirmed either
    // way, and saying zero landed would be as wrong as saying all did.
    referenceless = after.customers.length > 0 && uuidBySuid.size === 0;

    // Learn the provider's customer id from the list, since a save does not
    // return one. It turns call attribution from a phone match into an
    // identifier join.
    for (const row of writtenRows) {
      const uuid = uuidBySuid.get(suidFor(row));
      if (uuid) {
        await db.debtor.updateMany({
          where: { id: row.debtorId, organizationId },
          data: { providerContactUuid: uuid },
        });
      }
    }

    // Only meaningful when the write was supposed to be an update. On an
    // insert-started flow a second record for a number is the mechanism — that
    // is how a person is called twice — so counting it as damage would report
    // every repeat dial as a fault.
    if (after.complete && !armOnWrite) {
      for (const row of writtenRows) {
        const key = phoneKey(row.phone);
        if (!key) continue;
        const wasThere = byPhone.has(key) ? 1 : 0;
        const nowThere = phones.get(key) ?? 0;
        if (wasThere === 1 && nowThere > 1) duplicated += 1;
      }
    }
  }

  const complete =
    unsent === 0 &&
    failures.length === 0 &&
    armed === list.rowCount &&
    confirmed === list.rowCount &&
    flagIsFixed &&
    duplicated === 0 &&
    !referenceless;
  const missing = writtenRows.length - confirmed;
  const made = [
    created > 0 ? `${created} created` : null,
    updated > 0 ? `${updated} updated` : null,
    relinked > 0 ? `${relinked} matched to an existing record by number` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const nextStep = unsent > 0
    ? `${writtenRows.length} of ${list.rowCount} sent before this run hit its time limit — ${unsent} were not sent, and nobody on that part of the list has been called. Send again for the same campaign to continue with the rest; the accounts already sent are recorded and will not be sent twice.`
    : duplicated > 0
    ? `${duplicated} account(s) now have two records on the platform: they were already there without a reference, and the write made a second one instead of landing on the first. Merge or delete the duplicates in Jobix before dialling, or the same person is called twice.${made ? ` (${made}.)` : ""}`
    : !flagIsFixed && callFlag
    ? `${armed} customers written and stamped with ${callFlag} — this run's code, because no fixed call flag is configured. A flow's entry filter matches ONE value, so unless the filter names ${callFlag} exactly, nothing will dial. Set the call flag under Settings to the word your filter looks for, then send again.`
    : !callFlag
    ? `${writtenRows.length} customers are in Jobix, but nothing is armed: no call flag is configured, so the flow's filter will match nobody. Set one under Settings.`
    : complete
      ? armOnWrite
        ? `${armed} customers written with ${callFlag} in the call column and confirmed present on the platform${made ? ` — ${made}` : ""}. The flow starts on a customer being written, so the calls are already going out — there is nothing further to press.`
        : `${armed} customers written, armed with ${callFlag}, and confirmed present on the platform${made ? ` — ${made}` : ""}. Start the calls — the flow dials exactly these.`
      : failures.length > 0
        ? `${writtenRows.length} of ${list.rowCount} written, ${armed} armed. Fix the failures below before starting, or start and dial only what is armed.`
        : referenceless
          ? `${armed} written and accepted, but the platform's ${scanned} customer records carry no reference to match them against, so this cannot be confirmed either way. Check the customer list in Jobix before relying on it.`
          : !scanComplete
            ? `${armed} written and armed. Reading the platform back found ${confirmed} of them in ${scanned} records before running out of time, so treat that as a floor rather than a total — check the customer list in Jobix.`
            // "missing" is the count that could NOT be found. Saying "can be
            // found" inverted the meaning of the most important message in this
            // flow, so it read as success while describing a failure.
            : `Jobix accepted ${armed} write(s) and queued them, but ${missing} of ${writtenRows.length} CANNOT be found in its ${scanned} customer records afterwards. A queued write is not a created customer: the rows were accepted and then dropped, or rejected after acceptance. Nothing has been dialled. Use "Find what Jobix rejected" below — it writes this account a dozen ways in one pass, including the payload the connection test lands and the shape every dial this workspace has already made, and reports which of them the platform kept.`;

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
      created,
      updated,
      relinked,
      duplicated,
      unsent,
      callFlag,
      flagIsFixed,
      failed: failures.length,
    },
  });

  return {
    batchCode: options.batchCode,
    written: writtenRows.length,
    armed,
    created,
    updated,
    relinked,
    duplicated,
    unsent,
    confirmed,
    scanned,
    scanComplete,
    referenceless,
    flagIsFixed,
    dialledOnWrite: armOnWrite && !!callFlag,
    callFlag,
    attempted: list.rowCount,
    failures: failures.slice(0, 50),
    complete,
    nextStep,
    build: buildStamp(),
  };
}

// --- stopping a run --------------------------------------------------------

export type StopResult = {
  batchCode: string;
  /** Records found carrying this batch. */
  found: number;
  /** Records whose call column was cleared, so the flow no longer takes them. */
  cleared: number;
  failures: PushFailure[];
  scanned: number;
  scanComplete: boolean;
  message: string;
};

/**
 * Actually stop a run, by disarming it on the platform.
 *
 * There is no API to stop a flow, and "stopped" written into this platform's own
 * status column stops nothing — the voice platform has never heard of it. What
 * DOES stop a run is the thing that started it: the `call` column. A record with
 * an empty call column is not matched by the flow's entry filter, so it is not
 * dialled, and one still queued behind it is dropped when it gets there.
 *
 * Scoped to the batch, so stopping one campaign cannot disarm another's run.
 */
export async function stopBatch(
  organizationId: string,
  userId: string,
  batchCode: string,
): Promise<StopResult> {
  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");
  if (!env.companyKey) {
    throw new JobixError(
      "The company key is required to clear a batch. Set it under Settings.",
      "not_configured",
    );
  }
  const companyKey = env.companyKey;
  const client = new JobixClient(env);

  const list = await readCustomers(client, { withBatch: true });
  const mine = list.customers.filter((customer) => customer.batch === batchCode);
  const failures: PushFailure[] = [];
  let cleared = 0;

  for (const customer of mine) {
    if (!customer.suid) continue;
    try {
      await save(client, companyKey, { suid: customer.suid, timezone: TIMEZONE }, { call: "" });
      cleared += 1;
    } catch (err) {
      failures.push({ suid: customer.suid, name: customer.phone, reason: describe(err) });
    }
  }

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.batch_stopped",
    entityType: "call_batch",
    entityId: batchCode,
    detail: { found: mine.length, cleared, failed: failures.length, scanned: list.customers.length },
  });

  const message = !list.complete
    ? `Cleared ${cleared} of the ${mine.length} records found carrying ${batchCode}, but the customer list could not be read in full — there may be more still armed. Run this again, or clear the call column in Jobix.`
    : mine.length === 0
      ? `Nothing on the platform carries ${batchCode}, so there is nothing armed to stop. A call already connected runs to its end either way.`
      : cleared === mine.length
        ? `Disarmed ${cleared} record(s) carrying ${batchCode}: their call column is empty, so the flow will not take them. A call already connected runs to its end — this stops the ones not yet dialled.`
        : `Disarmed ${cleared} of ${mine.length} records carrying ${batchCode}. The rest are listed below and are still armed.`;

  return {
    batchCode,
    found: mine.length,
    cleared,
    failures: failures.slice(0, 50),
    scanned: list.customers.length,
    scanComplete: list.complete,
    message,
  };
}

// --- proving the write, one record at a time -------------------------------

/** One credential arrangement, tried and answered for. */
export type ProbeAttempt = {
  /** What was tried, in words. */
  arrangement: string;
  /** The reference written for this attempt. */
  suid: string;
  /** What was sent — the credential itself never appears. */
  sent: unknown;
  /** What came back. */
  received: unknown;
  /** Whether a record with this reference turned up afterwards. */
  landed: boolean;
};

export type WriteProbe = {
  attempts: ProbeAttempt[];
  /** Which build answered, so a stale deployment is visible on the screen
   *  rather than inferred from the wording afterwards. */
  build: string;
  /** The arrangement that produced a record, if any. */
  worked: string | null;
  scanned: number;
  scanComplete: boolean;
  verdict: string;
};

/**
 * Write one record and say what happened, in full.
 *
 * This exists because every failure in this integration looks the same from the
 * outside: the write is accepted, answers {queued: true}, and the customer is
 * nowhere. A campaign send is a slow and frightening way to test that — it can
 * dial people — so this writes ONE obviously-marked record, with NO call flag so
 * no flow can act on it, and reports the request, the response, and whether the
 * platform kept it.
 *
 * The payload is built the same way a real send builds one, so a difference
 * found here is a difference that matters.
 */
export async function probeWrite(
  organizationId: string,
  userId: string,
  options: { phone?: string } = {},
): Promise<WriteProbe> {
  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");

  const client = new JobixClient(env);
  // Never a real person's number, and never a call flag: nothing here may be
  // dialled.
  const phone = options.phone?.trim() || "+27000000000";
  const stamp = Date.now();

  const session = await client.sessionToken();
  const hint = (value: string) => (value.length <= 4 ? "…" : `…${value.slice(-4)}`);

  /**
   * The arrangements worth trying.
   *
   * Which value belongs in the Authorization header and which belongs in the
   * body has been inferred throughout, and Jobix labels the key an "API key
   * used to authenticate API requests" — a header credential, not a body
   * field. Rather than argue about it, each arrangement is tried once and the
   * platform's own answer decides. All are unarmed, so none can dial.
   */
  const plans: { arrangement: string; bearer: string | null; companyKey: string | null }[] = [
    {
      arrangement: "API key as the Authorization bearer, and in the body's company_key",
      bearer: env.token ?? null,
      companyKey: env.companyKey ?? null,
    },
    {
      arrangement: "API key as the Authorization bearer, no company_key in the body",
      bearer: env.token ?? null,
      companyKey: null,
    },
    {
      arrangement: "Dashboard session as the bearer, API key in the body's company_key",
      bearer: session,
      companyKey: env.companyKey ?? null,
    },
  ];

  const attempts: ProbeAttempt[] = [];
  for (const [index, plan] of plans.entries()) {
    if (!plan.bearer) continue;
    const suid = safeSuid(`aiployee-probe-${stamp}-${index + 1}`);
    const main = { suid, timezone: TIMEZONE, phone, name: "AIployee connection test" };
    const values = {
      full_name: "AIployee connection test",
      phone,
      total_due: 1,
      unit_number: "TEST",
      building_name: "AIployee connection test",
    };
    const body = {
      ...(plan.companyKey ? { company_key: plan.companyKey } : {}),
      customer_data: { main, values },
    };

    let received: unknown;
    try {
      received = await client.postWriteAs<Record<string, unknown>>(
        "/v1/customer/save",
        body,
        plan.bearer,
      );
    } catch (err) {
      received = { error: describe(err) };
    }

    attempts.push({
      arrangement: `${plan.arrangement}${plan.bearer ? ` (bearer ${hint(plan.bearer)})` : ""}${
        plan.companyKey ? `, company_key ${hint(plan.companyKey)}` : ""
      }`,
      suid,
      // The credential is replaced before this is ever displayed.
      sent: { ...(plan.companyKey ? { company_key: "[redacted]" } : {}), customer_data: { main, values } },
      received,
      landed: false,
    });
  }

  if (attempts.length === 0) {
    throw new JobixError(
      "No credential is available to write with. Set the API key and, if your workspace uses one, the company key under Settings.",
      "not_configured",
    );
  }

  // One read for all of them, after the queue has had a moment.
  await sleep(QUEUE_SETTLE_MS);
  const list = await readCustomers(client);
  const present = new Set(list.customers.map((customer) => customer.suid).filter(Boolean));
  for (const attempt of attempts) attempt.landed = present.has(attempt.suid);

  const worked = attempts.find((attempt) => attempt.landed)?.arrangement ?? null;
  const verdict = worked
    ? `This arrangement works: ${worked}. The platform will use it from now on.`
    : list.complete
      ? `None of the ${attempts.length} arrangements produced a record, in ${list.customers.length} customer records read. Every write was accepted and discarded, so the credential is being taken and ignored — which means the key is for a different workspace, or this endpoint needs something neither arrangement sent. The replies below are Jobix's own words on each.`
      : `Inconclusive: ${list.customers.length} records were read before the budget ran out and none of the probe references was among them. Raise JOBIX_CONFIRM_BUDGET_MS, or search the customer list in Jobix for "AIployee connection test".`;

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.write_probed",
    entityType: "integration_settings",
    entityId: organizationId,
    detail: {
      attempts: attempts.map((attempt) => ({ arrangement: attempt.arrangement, landed: attempt.landed })),
      scanned: list.customers.length,
    },
  });

  return {
    attempts,
    worked,
    build: buildStamp(),
    scanned: list.customers.length,
    scanComplete: list.complete,
    verdict,
  };
}

// --- finding the field that breaks a real send -----------------------------

export type RowProbeVariant = {
  /** What this variant adds beyond the set already proven to work. */
  variant: string;
  suid: string;
  sent: unknown;
  received: unknown;
  landed: boolean;
};

export type RowProbe = {
  account: string;
  /** Which build answered. Two rounds were spent on output from a deployment
   *  that did not carry the payload it was describing. */
  build: string;
  variants: RowProbeVariant[];
  scanned: number;
  scanComplete: boolean;
  verdict: string;
};

/**
 * Write one real account several ways at once, then read once.
 *
 * The connection probe lands and a campaign send does not. Two things can
 * explain that, and they need very different fixes:
 *
 *  - the SEND's payload carries something the platform refuses, or
 *  - the SEND's code path writes with a credential arrangement the platform
 *    refuses, while the connection probe found one that works.
 *
 * So the first variant is a control: the connection probe's own payload, byte
 * for byte, sent through the same function a campaign send uses. If that is
 * kept, the credential path is sound and the difference is in the account's
 * data. If it is discarded, no amount of field-bisecting will help — the send
 * is writing with the wrong credential.
 *
 * The rest bisect the account's data: its name, its number, its fields, and
 * each extra key on its own.
 *
 * Bisecting one write at a time would need a full customer-list read between
 * each attempt, which on a real workspace is most of a minute. So every variant
 * is written first, each under its own reference, and a single read says which
 * ones the platform kept.
 *
 * No variant carries the call flag, so none of them can dial, and every
 * synthetic number is in the unassignable +2700… range.
 */
export async function probeRow(
  organizationId: string,
  userId: string,
  options: { campaignId?: string } = {},
): Promise<RowProbe> {
  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");
  if (!env.companyKey) {
    throw new JobixError("The write API key is required. Set it under Settings.", "not_configured");
  }
  const companyKey = env.companyKey;
  const client = new JobixClient(env);

  const list = await buildJobixExport(organizationId, {
    campaignId: options.campaignId,
    batchCode: "PROBE",
  });
  const row = list.rows[0];
  if (!row) {
    throw new JobixError(
      "There is no eligible account to test with. Add one to the campaign first.",
      "rejected",
    );
  }

  const full = contactValues(row);
  delete full.call;
  const email = row.values.email ?? row.values.Email;

  // The set the connection probe proved, minus the number: it belongs in the
  // identity block, and a send no longer repeats it here. One variant below
  // puts it back, so the difference is measured rather than assumed.
  const proven: Record<string, string | number> = {
    full_name: row.name,
    ...(full.total_due !== undefined ? { total_due: full.total_due } : {}),
    ...(full.unit_number !== undefined ? { unit_number: full.unit_number } : {}),
    ...(full.building_name !== undefined ? { building_name: full.building_name } : {}),
  };
  const extras = Object.fromEntries(
    Object.entries(full).filter(([key]) => !(key in proven)),
  );

  const stamp = Date.now();
  // A number in the +2700… block: shaped like a South African number, never
  // assigned to anybody, so a variant that tests "is this number the problem"
  // cannot reach a person even if a flow somehow acted on it.
  const unusedPhone = `+27000${String(stamp).slice(-6)}`;
  const plainName = plainWireName(row.name);

  type RowPlan = {
    key: string;
    variant: string;
    main: Identity;
    values: Record<string, string | number>;
    /** Absent means "sent exactly the way a campaign send sends it". */
    as?: { bearer: string; companyKey: string | null };
  };

  const plans: RowPlan[] = [];
  const base = (n: number): Identity => ({
    suid: safeSuid(`aiployee-row-${stamp}-${n}`),
    timezone: TIMEZONE,
    phone: row.phone,
    name: row.name,
  });

  // The control. Same payload as the connection test — which the platform kept
  // — through the send's own write function.
  plans.push({
    key: "control",
    variant: "The connection test's exact payload, sent the way a campaign send sends it",
    main: {
      suid: safeSuid(`aiployee-row-${stamp}-0`),
      timezone: TIMEZONE,
      phone: "+27000000000",
      name: "AIployee connection test",
    },
    values: {
      full_name: "AIployee connection test",
      phone: "+27000000000",
      total_due: 1,
      unit_number: "TEST",
      building_name: "AIployee connection test",
    },
  });
  plans.push({
    key: "baseline",
    variant: "The fields the connection test proved, with this account's real data",
    main: base(1),
    values: proven,
  });
  if (plainName !== row.name) {
    plans.push({
      key: "name",
      variant: `Same again, with the name as plain text ("${plainName}" instead of "${row.name}")`,
      main: { ...base(2), name: plainName },
      values: { ...proven, full_name: plainName },
    });
  }
  plans.push({
    key: "phone",
    variant: "Same again, on a number the platform has never seen",
    main: { ...base(3), phone: unusedPhone },
    values: { ...proven, phone: unusedPhone },
  });
  plans.push({
    key: "unit",
    variant: "Same again, with a unit number present",
    main: base(4),
    values: { ...proven, unit_number: proven.unit_number ?? "TEST" },
  });
  plans.push({
    key: "identity",
    variant: "This account's amounts and building, under a fresh name and number",
    main: { ...base(5), phone: unusedPhone, name: "AIployee connection test" },
    values: { ...proven, full_name: "AIployee connection test", phone: unusedPhone },
  });
  plans.push({
    key: "everything",
    variant: "Everything a send writes",
    main: base(6),
    values: full,
  });
  plans.push({
    key: "valuesphone",
    variant: "Same again, with the number repeated in the fields as the connection test did",
    main: base(7),
    values: { ...proven, phone: row.phone },
  });
  plans.push({
    key: "uuid",
    variant: "Same again, under a plain uuid reference — the shape every dial this workspace has made used",
    main: { ...base(8), suid: randomUUID() },
    values: proven,
  });
  plans.push({
    key: "working",
    variant: "The exact shape of a dial this workspace has already made, with this account's data",
    main: { suid: randomUUID(), timezone: TIMEZONE, phone: row.phone, name: plainName },
    values: {
      full_name: plainName,
      ...(full.total_due !== undefined ? { total_due: full.total_due } : {}),
      ...(full.unit_number !== undefined ? { unit_number: full.unit_number } : {}),
      ...(full.building_name !== undefined ? { building_name: full.building_name } : {}),
      ...(typeof email === "string" && email ? { email } : {}),
    },
  });
  // The extras, one key at a time — this is the interesting part, and it costs
  // one write each rather than one read each.
  let n = 20;
  for (const [key, value] of Object.entries(extras)) {
    plans.push({
      key: `extra:${key}`,
      variant: `Proven fields, plus ${key}`,
      main: base(n),
      values: { ...proven, [key]: value },
    });
    n += 1;
  }
  // The other credential arrangements, on the payload the control uses. If the
  // control is discarded and one of these is kept, the send is simply writing
  // with the wrong credential — and this says which one to use.
  const session = await client.sessionToken();
  const arrangements: { key: string; label: string; bearer: string | null; companyKey: string | null }[] = [
    {
      key: "arrangement:key-only",
      label: "the API key as bearer and no company_key in the body",
      bearer: env.token ?? null,
      companyKey: null,
    },
    {
      key: "arrangement:session",
      label: "the dashboard session as bearer and the API key in the body",
      bearer: session,
      companyKey,
    },
  ];
  let a = 90;
  for (const arrangement of arrangements) {
    if (!arrangement.bearer) continue;
    plans.push({
      key: arrangement.key,
      variant: `The connection test's payload again, but with ${arrangement.label}`,
      main: {
        suid: safeSuid(`aiployee-row-${stamp}-${a}`),
        timezone: TIMEZONE,
        phone: "+27000000000",
        name: "AIployee connection test",
      },
      values: {
        full_name: "AIployee connection test",
        phone: "+27000000000",
        total_due: 1,
        unit_number: "TEST",
        building_name: "AIployee connection test",
      },
      as: { bearer: arrangement.bearer, companyKey: arrangement.companyKey },
    });
    a += 1;
  }

  const variants: RowProbeVariant[] = [];
  const byKey = new Map<string, RowProbeVariant>();
  for (const plan of plans) {
    let received: unknown;
    try {
      received = plan.as
        ? await client.postWriteAs<Record<string, unknown>>(
            "/v1/customer/save",
            {
              ...(plan.as.companyKey ? { company_key: plan.as.companyKey } : {}),
              customer_data: { main: plan.main, values: plan.values },
            },
            plan.as.bearer,
          )
        : await save(client, companyKey, plan.main, plan.values);
    } catch (err) {
      received = { error: describe(err) };
    }
    const variant: RowProbeVariant = {
      variant: plan.variant,
      suid: plan.main.suid,
      // The credential never appears: an arrangement is named in words only.
      sent: { main: plan.main, values: plan.values },
      received,
      landed: false,
    };
    variants.push(variant);
    byKey.set(plan.key, variant);
  }

  await sleep(QUEUE_SETTLE_MS);
  const after = await readCustomers(client);
  const present = new Set(after.customers.map((customer) => customer.suid).filter(Boolean));
  for (const variant of variants) variant.landed = present.has(variant.suid);

  const kept = (key: string) => byKey.get(key)?.landed === true;
  const tried = (key: string) => byKey.has(key);
  const culprits = [...byKey.entries()]
    .filter(([key, variant]) => key.startsWith("extra:") && !variant.landed)
    .map(([, variant]) => variant.variant.replace("Proven fields, plus ", ""));

  const workingArrangement = arrangements.find((arrangement) => kept(arrangement.key));

  let verdict: string;
  if (!after.complete) {
    // A read that did not finish cannot say a record is absent. Saying
    // otherwise here would send the next hour after a field that was fine.
    verdict = `The read ran out of time after ${after.customers.length} records, so nothing below can be trusted to mean "discarded" — the read may simply not have reached it. Run this again when the workspace is quieter.`;
  } else if (!kept("control") && !kept("baseline") && (kept("working") || kept("uuid"))) {
    // Checked before the credential, because it explains a control that was
    // itself discarded: the control copies the connection test, and the
    // connection test's reference is readable too. Only when BOTH readable
    // writes were refused and a uuid-keyed one was kept is the reference the
    // thing that separates them.
    verdict =
      "The reference is what the platform refuses. A write keyed on a plain uuid was kept where a readable reference was not — which is exactly how every dial this workspace has already made was keyed. A send now keys each write on a uuid, so send again.";
  } else if (!kept("control")) {
    verdict = workingArrangement
      ? `The payload is not the problem: the connection test's own payload was discarded when sent the way a campaign send sends it, and kept when sent with ${workingArrangement.label}. The send is writing with the wrong credential — that is the fix, and no field change is needed.`
      : "The connection test's own payload was discarded even though the connection test itself keeps it, and no other credential arrangement worked either. Nothing about this account's data is implicated. The difference is in how the send writes — the same payload, the same key, a different outcome — so treat the write path as unproven and re-run the connection test to see whether it still lands.";
  } else if (!kept("baseline")) {
    let cause =
      "something in this account's own data that none of these variants isolated. Its amounts, name and number were all refused together.";
    if (kept("valuesphone")) {
      cause =
        "the number missing from the fields: the write was kept as soon as the number appeared there as well as in the identity block.";
    } else if (kept("phone")) {
      cause =
        "the platform refuses a second record for a number it already holds. Every dial needs a fresh record, so this account cannot be re-dialled until its earlier records are removed or its number is written differently.";
    } else if (tried("name") && kept("name")) {
      cause = `the name. "${row.name}" was refused and "${plainName}" was kept, so the placeholder characters in the name are what the platform rejects.`;
    } else if (kept("unit")) {
      cause = "a missing unit number — the write was kept as soon as one was present.";
    } else if (kept("identity")) {
      cause =
        "this account's own name or number, not its amounts: the same amounts were kept under a fresh name and number.";
    }
    verdict = `The write path is sound — the control was kept. What the platform refuses is ${cause}`;
  } else if (kept("everything")) {
    verdict =
      "Everything a send writes was kept, on this account's real data. The payload is not the problem, so the difference is elsewhere — the call flag, or how many rows go at once.";
  } else if (culprits.length > 0) {
    verdict = `The send's full payload was discarded, and these are the fields that were refused on their own: ${culprits.join(", ")}. Removing them from what a send writes should fix it.`;
  } else {
    verdict =
      "The send's full payload was discarded, but every field was kept on its own — so it is the combination or the size of the payload, not one field.";
  }

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.row_probed",
    entityType: "debtor",
    entityId: row.debtorId,
    detail: {
      account: row.suid,
      landed: variants.filter((variant) => variant.landed).length,
      of: variants.length,
      control: kept("control"),
      baseline: kept("baseline"),
      culprits,
    },
  });

  return {
    account: `${row.name} (${row.suid})`,
    build: buildStamp(),
    variants,
    scanned: after.customers.length,
    scanComplete: after.complete,
    verdict,
  };
}
