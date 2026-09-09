import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// The balance guard.
//
// Across campaigns to date, 61 tenants were told they owed R6,147 when their
// real balances ran from R285 to R62,239 — a stale default reaching the agent
// instead of arrears_amount. Misstating a debt to a debtor is a Code of
// Conduct problem, so this runs after every round and BLOCKS the next one:
//
//   * a quoted figure that differs from that account's total_due by >10%
//   * any single figure quoted to three or more unrelated accounts
//
// Quoted figures are read from the AGENT's own turns in the transcript, since
// what the agent said is the thing regulated.
// ---------------------------------------------------------------------------

/** Rand figures in speech: "R6,147", "R 6147.50", "6147 rand". */
const MONEY_PATTERN = /(?:R\s?([\d][\d\s,]{2,12}(?:\.\d{1,2})?))|(?:([\d][\d\s,]{2,12})\s?rand)/gi;

export function quotedAmounts(agentText: string): number[] {
  const out: number[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(MONEY_PATTERN.source, "gi");
  while ((match = pattern.exec(agentText)) !== null) {
    const raw = (match[1] ?? match[2] ?? "").replace(/[\s,]/g, "");
    const value = Number(raw);
    // Below R100 is conversational arithmetic, not a balance.
    if (Number.isFinite(value) && value >= 100) out.push(Math.round(value));
  }
  return out;
}

type Turn = { role?: string; text?: string };

function agentText(turnsJson: string): string {
  try {
    const turns = JSON.parse(turnsJson) as Turn[];
    return turns
      .filter((t) => {
        const role = (t.role ?? "").toLowerCase();
        return role === "assistant" || role === "agent" || role === "bot";
      })
      .map((t) => t.text ?? "")
      .join("\n");
  } catch {
    return "";
  }
}

export type DriftFinding = {
  blocking: boolean;
  message: string;
  mismatches: { account: string; quoted: number; totalDue: number }[];
  recurring: { figure: number; accounts: number } | null;
};

/**
 * Run after a round closes. Creates the blocking alert itself, so a caller
 * cannot check and forget to block.
 */
export async function checkBalanceDrift(
  organizationId: string,
  campaignId: string,
  round: number,
): Promise<DriftFinding | null> {
  const attempts = await db.engineAttempt.findMany({
    where: { organizationId, campaignId, round, voided: false, reach: "SPOKE" },
    include: { account: { select: { id: true, fullName: true, totalDue: true } } },
  });
  if (attempts.length === 0) return null;

  const uuids = attempts.map((a) => a.conversationUuid);
  const transcripts = await db.jobixTranscript.findMany({
    where: { organizationId, conversationUuid: { in: uuids } },
    select: { conversationUuid: true, turns: true },
  });
  const turnsByUuid = new Map(transcripts.map((t) => [t.conversationUuid, t.turns]));

  const mismatches: DriftFinding["mismatches"] = [];
  const figureAccounts = new Map<number, Set<string>>();

  for (const attempt of attempts) {
    const turns = turnsByUuid.get(attempt.conversationUuid);
    if (!turns) continue;
    const amounts = quotedAmounts(agentText(turns));
    for (const amount of amounts) {
      const set = figureAccounts.get(amount) ?? new Set<string>();
      set.add(attempt.account.id);
      figureAccounts.set(amount, set);
    }
    // The figure closest to the account's balance is "the quote"; judge that
    // one, so a payment amount discussed later does not read as a misquote.
    if (amounts.length > 0) {
      const quoted = amounts.reduce((best, a) =>
        Math.abs(a - attempt.account.totalDue) < Math.abs(best - attempt.account.totalDue) ? a : best,
      );
      const drift = Math.abs(quoted - attempt.account.totalDue) / Math.max(1, attempt.account.totalDue);
      if (drift > 0.1) {
        mismatches.push({ account: attempt.account.fullName, quoted, totalDue: attempt.account.totalDue });
      }
    }
  }

  let recurring: DriftFinding["recurring"] = null;
  for (const [figure, accounts] of figureAccounts) {
    if (accounts.size >= 3 && (!recurring || accounts.size > recurring.accounts)) {
      recurring = { figure, accounts: accounts.size };
    }
  }

  if (mismatches.length === 0 && !recurring) return null;

  const message = recurring
    ? `The agent quoted R${recurring.figure.toLocaleString("en-ZA")} to ${recurring.accounts} tenants whose balances differ. Fix the balance mapping before the next round.`
    : `${mismatches.length} call(s) quoted a balance more than 10% away from the account's total_due. Check the balance mapping before the next round.`;

  await db.engineAlert.create({
    data: {
      organizationId,
      campaignId,
      kind: "balance_drift",
      message,
      detail: JSON.stringify({ mismatches: mismatches.slice(0, 20), recurring }),
    },
  });
  await db.campaign.update({ where: { id: campaignId }, data: { engineBlock: message } });

  return { blocking: true, message, mismatches, recurring };
}

/** A person read the alert; the block lifts, the alert stays on the record. */
export async function acknowledgeAlert(
  organizationId: string,
  alertId: string,
  userId: string,
): Promise<void> {
  const alert = await db.engineAlert.findFirstOrThrow({ where: { id: alertId, organizationId } });
  await db.$transaction([
    db.engineAlert.update({
      where: { id: alertId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
    }),
    db.campaign.update({ where: { id: alert.campaignId }, data: { engineBlock: null } }),
  ]);
}
