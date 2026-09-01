import { createHash } from "node:crypto";
import type { Campaign, EngineAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { denyList } from "@/services/jobix/calling";

// ---------------------------------------------------------------------------
// Rounds and batches.
//
// A round is one pass over whoever is still worth calling; a batch is the
// slice of a round the platform is fed at a time. Batch membership is frozen
// at creation: if an account's eligibility changes mid-round, that affects the
// NEXT round, never a list already cut. Recomputing a live list is how the
// same person gets dialled twice.
// ---------------------------------------------------------------------------

/** Firm outcomes: a human takes over; the dialler never touches these again. */
export const RESOLVED_OUTCOMES = [
  "PTP", "PART", "PAID", "DISPUTE", "CALLBACK", "OFFICE", "ESCALATED", "REFUSED", "WRONG",
] as const;

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/** 01SEP-R2-B3 — date, round, batch. Globally unique per campaign by constraint. */
export function engineBatchCode(round: number, index: number, now = new Date()): string {
  const sast = new Date(now.getTime() + 2 * 3_600_000);
  const stamp = `${String(sast.getUTCDate()).padStart(2, "0")}${MONTHS[sast.getUTCMonth()]}`;
  return `${stamp}-R${round}-B${index}`;
}

/** Lock 4's key: replaying the same upload must be a no-op, not a second run. */
export function batchIdempotencyKey(campaignId: string, code: string): string {
  return createHash("sha256").update(`${campaignId}:${code}`).digest("hex");
}

export type Ineligible = { reason: string; count: number; arrears: number };

export type Eligibility = {
  eligible: EngineAccount[];
  excluded: Ineligible[];
  /** Accounts newly pushed over the attempt cap by this evaluation. */
  newlyExhausted: string[];
};

/**
 * Who the next round may call — §5.1, in one place.
 *
 * Excluded: resolved outcomes (they belong to a human now), do-not-call,
 * undialable, the internal test lines, and anybody at the attempt cap.
 * Everything else is redialled: rang unanswered, voicemail, answered with no
 * outcome captured, and zero-duration accounts from a voided delivery-failure
 * round (whose attempts, by design, never counted).
 */
export function evaluateEligibility(campaign: Campaign, accounts: EngineAccount[]): Eligibility {
  const denied = new Set(denyList());
  const excluded = new Map<string, { count: number; arrears: number }>();
  const skip = (reason: string, account: EngineAccount) => {
    const entry = excluded.get(reason) ?? { count: 0, arrears: 0 };
    entry.count += 1;
    entry.arrears += account.totalDue;
    excluded.set(reason, entry);
  };

  const eligible: EngineAccount[] = [];
  const newlyExhausted: string[] = [];

  for (const account of accounts) {
    if (account.state === "undialable" || !account.phone) {
      skip("no usable number", account);
      continue;
    }
    if (account.doNotCall) {
      skip("do-not-call flag", account);
      continue;
    }
    if (denied.has(account.phone)) {
      skip("internal test line", account);
      continue;
    }
    if (account.outcome && (RESOLVED_OUTCOMES as readonly string[]).includes(account.outcome)) {
      skip(`resolved: ${account.outcome}`, account);
      continue;
    }
    if (account.state === "resolved") {
      skip("resolved", account);
      continue;
    }
    if (account.attempts >= campaign.maxRounds) {
      if (account.state !== "exhausted") newlyExhausted.push(account.id);
      skip("attempt cap reached — switch channel", account);
      continue;
    }
    eligible.push(account);
  }

  return {
    eligible,
    excluded: [...excluded.entries()].map(([reason, entry]) => ({ reason, ...entry })),
    newlyExhausted,
  };
}

export type RoundPlan = {
  round: number;
  accounts: number;
  arrears: number;
  batches: { code: string; accounts: number; arrears: number }[];
  excluded: Ineligible[];
};

/**
 * Cut the next round: eligible accounts, largest balances first so the first
 * batch carries the most money, split into frozen batches.
 */
export async function buildRound(
  organizationId: string,
  campaignId: string,
  userId: string,
): Promise<RoundPlan> {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
  if (!campaign) throw new Error("Campaign not found");
  if (!["ready", "between_rounds"].includes(campaign.engineStatus)) {
    throw new Error(`A round cannot be cut while the campaign is ${campaign.engineStatus}.`);
  }
  if (campaign.engineBlock) {
    throw new Error(
      `A guard is blocking the next round: ${campaign.engineBlock}. Acknowledge the alert first.`,
    );
  }
  if (campaign.currentRound >= campaign.maxRounds) {
    throw new Error(
      `Round ${campaign.currentRound} was the last automated round (cap ${campaign.maxRounds}). What is left belongs on the switch-channel list.`,
    );
  }

  const accounts = await db.engineAccount.findMany({ where: { campaignId } });
  const { eligible, excluded, newlyExhausted } = evaluateEligibility(campaign, accounts);
  if (eligible.length === 0) {
    throw new Error("Nobody is eligible for another round — the campaign is ready to review.");
  }

  const round = campaign.currentRound + 1;
  const ordered = [...eligible].sort((a, b) => b.totalDue - a.totalDue);
  const chunks: EngineAccount[][] = [];
  for (let i = 0; i < ordered.length; i += campaign.batchSize) {
    chunks.push(ordered.slice(i, i + campaign.batchSize));
  }

  const plan = await db.$transaction(async (tx) => {
    if (newlyExhausted.length > 0) {
      await tx.engineAccount.updateMany({
        where: { id: { in: newlyExhausted } },
        data: { state: "exhausted" },
      });
    }

    const batches: RoundPlan["batches"] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const code = engineBatchCode(round, index + 1);
      // A code is used once per campaign, ever. The unique constraint enforces
      // it; this check exists to say so in words instead of a constraint error.
      const existing = await tx.engineBatch.findFirst({ where: { campaignId, code } });
      if (existing) throw new Error(`Batch code ${code} already exists in this campaign.`);
      await tx.engineBatch.create({
        data: {
          organizationId,
          campaignId,
          round,
          index: index + 1,
          code,
          accountIds: JSON.stringify(chunk.map((a) => a.id)),
          accountCount: chunk.length,
          arrears: chunk.reduce((sum, a) => sum + a.totalDue, 0),
          idempotencyKey: batchIdempotencyKey(campaignId, code),
        },
      });
      batches.push({
        code,
        accounts: chunk.length,
        arrears: chunk.reduce((sum, a) => sum + a.totalDue, 0),
      });
    }

    await tx.engineAccount.updateMany({
      where: { id: { in: ordered.map((a) => a.id) } },
      data: { state: "queued" },
    });
    await tx.campaign.update({
      where: { id: campaignId },
      data: { currentRound: round, engineStatus: "calling" },
    });

    return {
      round,
      accounts: ordered.length,
      arrears: ordered.reduce((sum, a) => sum + a.totalDue, 0),
      batches,
      excluded,
    };
  });

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "engine.round_built",
    entityType: "campaign",
    entityId: campaignId,
    detail: { round: plan.round, accounts: plan.accounts, arrears: plan.arrears, batches: plan.batches.length },
  });

  return plan;
}
