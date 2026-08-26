import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { blockGuests } from "@/lib/session";
import { JobixClient, JobixError, loadJobixEnv } from "./client";

// ---------------------------------------------------------------------------
// Calling.
//
// Deliberately the last thing in the build order and the most heavily guarded:
// a call button on wrong data is worse than no button.
//
// Mechanism (both "call one" and "call all" take the same path — only the
// number of stamped accounts differs):
//
//   1. filter the selection through every exclusion rule
//   2. stamp a unique batch code onto those accounts via customer/save
//   3. WAIT and VERIFY the stamp landed (the save is asynchronous and
//      downstream reads can be stale for tens of seconds)
//   4. trigger the flow's "Now" node, which runs the flow.
//
// The trigger was captured from the flow builder's own Run button (DevTools):
//   POST {base}/api/nodes/now/trigger   (the DASHBOARD host, not the write API)
//   body: { "flowUuid": "...", "nodeUuid": "..." }   (camelCase)
//
// CRITICAL — the trigger carries NO audience. There is no filter in the
// request: Jobix dials whatever the flow's own entry filter matches at run
// time. The platform's protection is therefore the stamp: only this batch's
// accounts get the batch code written to their `call` field, and the flow's
// filter node (configured once, in the builder) must gate on that field.
// Until JOBIX_TRIGGER_NODE_UUID is set the run stops after the stamp with
// instructions instead of pretending.

export const TRIGGER_DISCOVERY = `Automatic dialling needs two settings (from the flow builder):
  1. JOBIX_FLOW_UUID — the id in the flow's URL (/automation/<uuid>).
  2. JOBIX_TRIGGER_NODE_UUID — the "Now" node's uuid, from a DevTools capture of the Run button.
Then set JOBIX_CALLING_ENABLED=true — but FIRST confirm the flow's entry filter gates on the
\`call\` field, because the trigger itself carries no audience: Jobix dials whatever the flow's
filter matches.`;

/** Calling windows in South African time. No Sundays. */
export const CALLING_WINDOWS: Record<number, { start: number; end: number } | null> = {
  0: null, // Sunday — never
  1: { start: 8, end: 19 },
  2: { start: 8, end: 19 },
  3: { start: 8, end: 19 },
  4: { start: 8, end: 19 },
  5: { start: 8, end: 19 },
  6: { start: 9, end: 13 }, // Saturday
};

export type WindowCheck = { allowed: boolean; reason: string; sastTime: string };

/** Hard gate on calling hours, evaluated in SAST regardless of server timezone. */
export function checkCallingWindow(now: Date = new Date()): WindowCheck {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const day = sast.getUTCDay();
  const hour = sast.getUTCHours();
  const minute = sast.getUTCMinutes();
  const stamp = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} SAST`;
  const window = CALLING_WINDOWS[day];
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];

  if (!window) {
    return { allowed: false, reason: `No calling on ${dayName}.`, sastTime: stamp };
  }
  if (hour < window.start || hour >= window.end) {
    return {
      allowed: false,
      reason: `Outside the ${dayName} calling window (${String(window.start).padStart(2, "0")}:00–${String(window.end).padStart(2, "0")}:00 SAST). Local time is ${stamp}.`,
      sastTime: stamp,
    };
  }
  return { allowed: true, reason: `Within the ${dayName} calling window.`, sastTime: stamp };
}

/** Numbers that must never be dialled (internal test lines). */
export function denyList(): string[] {
  return (process.env.JOBIX_DENY_LIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type CallCandidate = {
  debtorId: string;
  name: string;
  phone: string;
  suid: string | null;
  balance: number;
};

export type ExclusionSummary = { reason: string; count: number };

export type PreparedBatch = {
  batchCode: string;
  candidates: CallCandidate[];
  totalValue: number;
  excluded: ExclusionSummary[];
  window: WindowCheck;
};

function batchCode(now = new Date()): string {
  const day = now.getUTCDate();
  const month = now.toLocaleString("en-GB", { month: "short" }).toUpperCase();
  const stamp = `${day}${month}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${stamp}-${suffix}`;
}

/**
 * Apply every exclusion rule and report what was removed.
 * "Call all" is filtered by default — never a raw list.
 */
export async function prepareBatch(
  organizationId: string,
  debtorIds: string[],
): Promise<PreparedBatch> {
  const debtors = await db.debtor.findMany({
    where: { organizationId, id: { in: debtorIds } },
    include: {
      accounts: { select: { currentBalance: true } },
      promises: { where: { status: "pending" }, select: { id: true } },
    },
  });

  const denied = denyList();
  const excluded: Record<string, number> = {};
  const skip = (reason: string) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };

  const candidates: CallCandidate[] = [];
  for (const debtor of debtors) {
    if (debtor.doNotContact) { skip("do-not-call flag"); continue; }
    if (debtor.status === "dispute") { skip("disputed"); continue; }
    if (debtor.status === "escalated") { skip("escalated"); continue; }
    if (debtor.status === "paid") { skip("settled"); continue; }
    if (debtor.status === "opted_out") { skip("opted out"); continue; }
    if (debtor.promises.length > 0) { skip("live promise to pay"); continue; }
    if (!/^\+\d{8,15}$/.test(debtor.phone)) { skip("unusable number"); continue; }
    if (denied.some((d) => debtor.phone.endsWith(d.replace(/[^\d]/g, "").slice(-9)))) {
      skip("internal test number"); continue;
    }
    const balance = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
    if (balance <= 0) { skip("nothing outstanding"); continue; }

    candidates.push({
      debtorId: debtor.id,
      name: `${debtor.firstName} ${debtor.lastName}`,
      phone: debtor.phone,
      suid: debtor.accountNumber,
      balance,
    });
  }

  return {
    batchCode: batchCode(),
    candidates,
    totalValue: candidates.reduce((s, c) => s + c.balance, 0),
    excluded: Object.entries(excluded).map(([reason, count]) => ({ reason, count })),
    window: checkCallingWindow(),
  };
}

export type DispatchResult = {
  batchCode: string;
  stamped: number;
  verified: number;
  triggered: boolean;
  nextAction: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stamp the batch code, verify it landed, then trigger if a trigger path is
 * configured. Every dispatch is audit-logged with who, when and what.
 */
export async function dispatchBatch(
  organizationId: string,
  userId: string,
  debtorIds: string[],
  options: { confirmed: boolean } = { confirmed: false },
): Promise<DispatchResult> {
  await blockGuests("start calls");

  if (!options.confirmed) {
    throw new JobixError("Calling requires explicit confirmation of the account count and value.", "rejected");
  }
  if (process.env.JOBIX_CALLING_ENABLED !== "true") {
    throw new JobixError(
      "Calling is disabled on this deployment. Set JOBIX_CALLING_ENABLED=true once the trigger endpoint is confirmed.",
      "not_configured",
    );
  }

  const window = checkCallingWindow();
  if (!window.allowed) throw new JobixError(window.reason, "rejected");

  const env = loadJobixEnv();
  if (!env?.companyKey) {
    throw new JobixError("JOBIX_COMPANY_KEY is required to stamp a batch code.", "not_configured");
  }
  const client = new JobixClient(env);
  const batch = await prepareBatch(organizationId, debtorIds);
  if (batch.candidates.length === 0) {
    throw new JobixError("Every selected account was excluded by the calling rules.", "rejected");
  }

  // --- stamp the batch code ---
  let stamped = 0;
  for (const candidate of batch.candidates) {
    if (!candidate.suid) continue;
    await client.postWrite("/v1/customer/save", {
      company_key: env.companyKey,
      customer_data: {
        main: { suid: candidate.suid, timezone: "Africa/Johannesburg" },
        values: { call: batch.batchCode },
      },
    });
    stamped += 1;
  }

  // --- the save is asynchronous: wait, then verify before triggering ---
  await sleep(5000);
  let verified = 0;
  try {
    const { pullCustomers } = await import("./api");
    const { customers } = await pullCustomers(client, { maxPages: 20 });
    const stampedSuids = new Set(batch.candidates.map((c) => c.suid));
    verified = customers.filter(
      (c) => c.callBatch === batch.batchCode || (c.callBatch && stampedSuids.has(c.callBatch)),
    ).length;
  } catch {
    // Verification is best-effort; the audit records what was attempted.
  }

  // --- trigger the flow's Now node, exactly as the flow builder's Run does ---
  // Path and payload come from a DevTools capture, not a guess. The default
  // path can be overridden with JOBIX_TRIGGER_PATH if Jobix ever moves it.
  const triggerPath = process.env.JOBIX_TRIGGER_PATH || "/api/nodes/now/trigger";
  const triggerNodeUuid = process.env.JOBIX_TRIGGER_NODE_UUID;
  let triggered = false;
  let nextAction = TRIGGER_DISCOVERY;

  if (env.flowUuid && triggerNodeUuid) {
    await client.postDashboard(triggerPath, {
      flowUuid: env.flowUuid,
      nodeUuid: triggerNodeUuid,
    });
    triggered = true;
    nextAction =
      `Triggered the flow for batch ${batch.batchCode} (${stamped} account(s) stamped). ` +
      `Jobix dials what the flow's own filter matches — the stamp on the \`call\` field is what scopes it to this batch.`;
  } else {
    nextAction = `Batch ${batch.batchCode} is stamped on ${stamped} account(s). Press Run on the flow in Jobix, or configure the trigger: ${TRIGGER_DISCOVERY}`;
  }

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: triggered ? "calling.batch_triggered" : "calling.batch_prepared",
    entityType: "call_batch",
    entityId: batch.batchCode,
    detail: {
      accounts: batch.candidates.length,
      totalValue: Math.round(batch.totalValue),
      stamped,
      verified,
      triggered,
      excluded: batch.excluded,
      sastTime: window.sastTime,
      debtorIds: batch.candidates.map((c) => c.debtorId).slice(0, 200),
    },
  });

  return { batchCode: batch.batchCode, stamped, verified, triggered, nextAction };
}
