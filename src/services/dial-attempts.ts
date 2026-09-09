import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Reading a dial back.
//
// One shape for the panel that watches a call and for the list on an account,
// so both say the same thing about the same attempt.
// ---------------------------------------------------------------------------

export type DialAttemptView = {
  id: string;
  suid: string;
  name: string;
  phone: string;
  /** placed | reached | no_answer | failed */
  state: string;
  requestedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  outcome: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  callId: string | null;
  debtorId: string | null;
  /** What the analysis made of it, once a transcript has been read. */
  analysis: {
    summary: string | null;
    sentiment: string | null;
    requiresHuman: boolean;
    nextAction: string | null;
  } | null;
  /** The promise this call captured, if it captured one. */
  promise: { id: string; amount: number; promisedDate: string } | null;
  /** How long the platform has had to answer, in seconds. */
  waitingSeconds: number;
};

/**
 * A call still has time to arrive.
 *
 * A dial that has been open a couple of minutes is a call in progress; one open
 * for half an hour is a call that never reported back, and saying "waiting" for
 * ever would be the sort of quiet lie this integration has already told once.
 */
export const OUTCOME_GRACE_SECONDS = 20 * 60;

export function isStale(view: DialAttemptView): boolean {
  return view.state === "placed" && view.waitingSeconds > OUTCOME_GRACE_SECONDS;
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(where: Record<string, unknown>, take: number) {
  return db.dialAttempt.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    take,
  });
}

async function decorate(rows: Row[], organizationId: string): Promise<DialAttemptView[]> {
  const callIds = rows.map((row) => row.callId).filter((id): id is string => !!id);
  const [analyses, promises] = await Promise.all([
    callIds.length
      ? db.callAnalysis.findMany({
          where: { organizationId, callId: { in: callIds } },
          select: {
            callId: true,
            summary: true,
            sentiment: true,
            requiresHuman: true,
            nextAction: true,
          },
        })
      : Promise.resolve([]),
    callIds.length
      ? db.promiseToPay.findMany({
          where: { organizationId, callId: { in: callIds } },
          select: { id: true, callId: true, amount: true, promisedDate: true },
        })
      : Promise.resolve([]),
  ]);
  const analysisByCall = new Map(analyses.map((a) => [a.callId, a]));
  const promiseByCall = new Map(promises.map((p) => [p.callId, p]));
  const now = Date.now();

  return rows.map((row) => {
    const analysis = row.callId ? analysisByCall.get(row.callId) : undefined;
    const promise = row.callId ? promiseByCall.get(row.callId) : undefined;
    return {
      id: row.id,
      suid: row.suid,
      name: row.name,
      phone: row.phone,
      state: row.state,
      requestedAt: row.requestedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      durationSeconds: row.durationSeconds,
      outcome: row.outcome,
      transcript: row.transcript,
      recordingUrl: row.recordingUrl,
      callId: row.callId,
      debtorId: row.debtorId,
      analysis: analysis
        ? {
            summary: analysis.summary,
            sentiment: analysis.sentiment,
            requiresHuman: analysis.requiresHuman,
            nextAction: analysis.nextAction,
          }
        : null,
      promise: promise
        ? {
            id: promise.id,
            amount: promise.amount,
            promisedDate: promise.promisedDate.toISOString(),
          }
        : null,
      waitingSeconds: Math.max(0, Math.round((now - row.requestedAt.getTime()) / 1000)),
    };
  });
}

export async function getDialAttempt(
  organizationId: string,
  id: string,
): Promise<DialAttemptView | null> {
  const rows = await loadRows({ organizationId, id }, 1);
  if (rows.length === 0) return null;
  return (await decorate(rows, organizationId))[0];
}

export async function listDialAttempts(
  organizationId: string,
  options: { debtorId?: string; limit?: number } = {},
): Promise<DialAttemptView[]> {
  const rows = await loadRows(
    { organizationId, ...(options.debtorId ? { debtorId: options.debtorId } : {}) },
    options.limit ?? 10,
  );
  return decorate(rows, organizationId);
}
