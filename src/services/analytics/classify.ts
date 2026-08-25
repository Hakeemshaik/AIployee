// ---------------------------------------------------------------------------
// Account classification and campaign metrics.
//
// These rules were established against live production data and several are
// counter-intuitive. The naive implementation produces confidently wrong
// numbers, so the reasoning is recorded inline:
//
//  * "Reached" is decided from TRANSCRIPT CONTENT, never from platform flags
//    (the platform's voicemail flag produced 164 false positives in one
//    campaign).
//  * Every metric is per ACCOUNT, never per call — an account dialled six
//    times is one account.
//  * The PTP-rate denominator is accounts with a real conversation (RPC), not
//    total calls and not total accounts.
//  * Commitments without a stated amount carry zero in the floor and the full
//    balance in the ceiling, so cash committed is always a range.
//  * Cumulative reach counts unique accounts at their FIRST reach; summing
//    per-round "reached" columns double-counts.
//  * Provider timestamps are UTC; South Africa is UTC+2.
// ---------------------------------------------------------------------------

/** Phrases that indicate a machine answered rather than a person. */
export const MACHINE_PATTERN =
  /(voicemail|leave a message|after the tone|not available|unavailable|please leave|voice mail|mailbox|subscriber|switched off|does not exist|try again later|answering machine|record your message|cannot be reached|no longer in service)/i;

export type TranscriptSummary = {
  conversationUuid: string;
  /** Number of turns spoken by the tenant (role "user"). */
  userTurns: number;
  /** Concatenated tenant speech. */
  userText: string;
  /** Word count of tenant speech. */
  userWords: number;
};

/**
 * Right-party contact: at least one genuine spoken turn from the tenant.
 * A short machine-sounding utterance ("...is not available", under 15 words)
 * is treated as a machine, not a person.
 */
export function isReached(t: Pick<TranscriptSummary, "userTurns" | "userText" | "userWords">): boolean {
  return t.userTurns > 0 && !(MACHINE_PATTERN.test(t.userText) && t.userWords < 15);
}

/** Build a transcript summary from raw turns, tolerating both text fields. */
export function summariseTranscript(
  conversationUuid: string,
  turns: { role: string; content?: string | null; text?: string | null }[],
): TranscriptSummary {
  const userTexts: string[] = [];
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const body = (turn.content ?? turn.text ?? "").trim();
    if (body) userTexts.push(body);
  }
  const userText = userTexts.join(" ");
  return {
    conversationUuid,
    userTurns: userTexts.length,
    userText,
    userWords: userText ? userText.split(/\s+/).filter(Boolean).length : 0,
  };
}

// --- buckets ----------------------------------------------------------------

export const ACCOUNT_BUCKETS = [
  "conversation",
  "answered_few_words",
  "connected_no_conversation",
  "never_connected",
  "never_called",
] as const;
export type AccountBucket = (typeof ACCOUNT_BUCKETS)[number];

export const BUCKET_LABELS: Record<AccountBucket, string> = {
  conversation: "Conversation",
  answered_few_words: "Answered, few words",
  connected_no_conversation: "Connected, no conversation",
  never_connected: "Never connected (dead)",
  never_called: "Never called",
};

export const BUCKET_EXPLANATIONS: Record<AccountBucket, string> = {
  conversation: "Reached and the tenant said 8 or more words",
  answered_few_words: "Reached but the tenant said fewer than 8 words",
  connected_no_conversation: "Not reached, but at least one call had talk time above zero",
  never_connected: "Not reached and every call had zero talk time — the number is likely dead",
  never_called: "No call records at all",
};

/** A minimal call record, as needed by classification. */
export type ClassifiableCall = {
  conversationUuid: string;
  durationSeconds: number;
  startedAt: Date;
  /** Transcript summary, when one has been fetched. */
  transcript?: TranscriptSummary | null;
};

export type ClassifiableAccount = {
  accountId: string;
  phone: string;
  balance: number;
  calls: ClassifiableCall[];
  /** Outcome fields from the provider's customer record, already unwrapped. */
  outcome?: {
    ptpConfirmed?: boolean;
    ptpAmount?: number | null;
    disputed?: boolean;
    paidClaimed?: boolean;
    escalated?: boolean;
    doNotCall?: boolean;
  } | null;
};

export type ClassifiedAccount = {
  accountId: string;
  bucket: AccountBucket;
  reached: boolean;
  attempts: number;
  bestDurationSeconds: number;
  tenantWords: number;
  /** 1-based attempt number on which the account was first reached. */
  firstReachAttempt: number | null;
  firstReachAt: Date | null;
};

const CONVERSATION_WORD_FLOOR = 8;

export function classifyAccount(account: ClassifiableAccount): ClassifiedAccount {
  // Attempt order is by time, never by the provider's returned order.
  const calls = [...account.calls].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  let reached = false;
  let tenantWords = 0;
  let firstReachAttempt: number | null = null;
  let firstReachAt: Date | null = null;

  calls.forEach((call, index) => {
    const t = call.transcript;
    if (!t) return;
    if (isReached(t)) {
      if (!reached) {
        firstReachAttempt = index + 1;
        firstReachAt = call.startedAt;
      }
      reached = true;
      tenantWords = Math.max(tenantWords, t.userWords);
    }
  });

  const bestDurationSeconds = calls.reduce((max, c) => Math.max(max, c.durationSeconds), 0);

  let bucket: AccountBucket;
  if (calls.length === 0) {
    bucket = "never_called";
  } else if (reached) {
    bucket = tenantWords >= CONVERSATION_WORD_FLOOR ? "conversation" : "answered_few_words";
  } else if (bestDurationSeconds > 0) {
    bucket = "connected_no_conversation";
  } else {
    bucket = "never_connected";
  }

  return {
    accountId: account.accountId,
    bucket,
    reached,
    attempts: calls.length,
    bestDurationSeconds,
    tenantWords,
    firstReachAttempt,
    firstReachAt,
  };
}

// --- campaign metrics -------------------------------------------------------

export type CommitmentRange = {
  /** Stated amounts only. */
  floor: number;
  /** Stated amounts, plus full balance where no amount was stated. */
  ceiling: number;
  /** Total arrears owed by committed accounts — NOT cash committed. */
  arrearsUnderCommitment: number;
  count: number;
  withoutStatedAmount: number;
};

export type CampaignAnalytics = {
  accounts: number;
  calls: number;
  attempted: number;
  buckets: Record<AccountBucket, number>;
  reachedAccounts: number;
  conversationAccounts: number;
  deadNumberAccounts: number;
  /** accounts with ≥1 attempt / accounts in book */
  penetration: number;
  /** accounts with a conversation / accounts in book */
  rpcRate: number;
  /** total calls / accounts with a conversation */
  dialsPerRpc: number;
  /** promises / accounts with a conversation */
  ptpRate: number;
  /** dead-number accounts / accounts dialled */
  dataQualityFailRate: number;
  commitments: CommitmentRange;
  /** Cumulative unique accounts reached, indexed by attempt number. */
  reachByAttempt: { attempt: number; firstReached: number; cumulative: number; cumulativeRate: number }[];
  /** Reach rate by hour of day in SAST (UTC+2). */
  reachByHour: { hour: number; attempts: number; reached: number; rate: number }[];
};

const SAST_OFFSET_HOURS = 2;

/** Hour of day in South African time for a UTC timestamp. */
export function sastHour(utc: Date): number {
  return (utc.getUTCHours() + SAST_OFFSET_HOURS) % 24;
}

export function computeCampaignAnalytics(accounts: ClassifiableAccount[]): CampaignAnalytics {
  const classified = accounts.map(classifyAccount);
  const byId = new Map(classified.map((c) => [c.accountId, c]));

  const buckets = Object.fromEntries(ACCOUNT_BUCKETS.map((b) => [b, 0])) as Record<AccountBucket, number>;
  for (const c of classified) buckets[c.bucket] += 1;

  const totalCalls = accounts.reduce((s, a) => s + a.calls.length, 0);
  const attempted = classified.filter((c) => c.attempts > 0).length;
  const reachedAccounts = classified.filter((c) => c.reached).length;
  const conversationAccounts = buckets.conversation;
  const deadNumberAccounts = buckets.never_connected;

  // --- commitments: floor and ceiling, never a single number ---
  let floor = 0;
  let ceiling = 0;
  let arrearsUnderCommitment = 0;
  let commitmentCount = 0;
  let withoutStatedAmount = 0;
  for (const account of accounts) {
    if (!account.outcome?.ptpConfirmed) continue;
    commitmentCount += 1;
    arrearsUnderCommitment += account.balance;
    const stated = account.outcome.ptpAmount;
    if (stated && stated > 0) {
      floor += stated;
      ceiling += stated;
    } else {
      // No amount stated: nothing in the floor, full balance in the ceiling.
      withoutStatedAmount += 1;
      ceiling += account.balance;
    }
  }

  // --- cumulative reach by first-reach attempt (unique accounts only) ---
  const maxAttempts = classified.reduce((max, c) => Math.max(max, c.attempts), 0);
  const firstReachCounts = new Map<number, number>();
  for (const c of classified) {
    if (c.firstReachAttempt == null) continue;
    firstReachCounts.set(c.firstReachAttempt, (firstReachCounts.get(c.firstReachAttempt) ?? 0) + 1);
  }
  const reachByAttempt: CampaignAnalytics["reachByAttempt"] = [];
  let cumulative = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const firstReached = firstReachCounts.get(attempt) ?? 0;
    cumulative += firstReached;
    reachByAttempt.push({
      attempt,
      firstReached,
      cumulative,
      cumulativeRate: accounts.length > 0 ? cumulative / accounts.length : 0,
    });
  }

  // --- reach rate by hour of day (SAST) ---
  const hourBuckets = new Map<number, { attempts: number; reached: number }>();
  for (const account of accounts) {
    for (const call of account.calls) {
      const hour = sastHour(call.startedAt);
      const entry = hourBuckets.get(hour) ?? { attempts: 0, reached: 0 };
      entry.attempts += 1;
      if (call.transcript && isReached(call.transcript)) entry.reached += 1;
      hourBuckets.set(hour, entry);
    }
  }
  const reachByHour = [...hourBuckets.entries()]
    .map(([hour, v]) => ({ hour, attempts: v.attempts, reached: v.reached, rate: v.attempts > 0 ? v.reached / v.attempts : 0 }))
    .sort((a, b) => a.hour - b.hour);

  const promises = commitmentCount;

  return {
    accounts: accounts.length,
    calls: totalCalls,
    attempted,
    buckets,
    reachedAccounts,
    conversationAccounts,
    deadNumberAccounts,
    penetration: accounts.length > 0 ? attempted / accounts.length : 0,
    rpcRate: accounts.length > 0 ? conversationAccounts / accounts.length : 0,
    dialsPerRpc: conversationAccounts > 0 ? totalCalls / conversationAccounts : 0,
    ptpRate: conversationAccounts > 0 ? promises / conversationAccounts : 0,
    dataQualityFailRate: attempted > 0 ? deadNumberAccounts / attempted : 0,
    commitments: { floor, ceiling, arrearsUnderCommitment, count: commitmentCount, withoutStatedAmount },
    reachByAttempt,
    reachByHour,
  };
}

/** Exposed so every metric tooltip states its exact formula. */
export const METRIC_FORMULAS = {
  penetration: "accounts with ≥1 attempt ÷ accounts in book",
  rpcRate: "accounts with a conversation ÷ accounts in book",
  dialsPerRpc: "total calls ÷ accounts with a conversation",
  ptpRate: "promises ÷ accounts with a conversation (RPC denominator, not calls)",
  dataQualityFailRate: "dead-number accounts ÷ accounts dialled",
  cashCommittedFloor: "sum of stated commitment amounts only",
  cashCommittedCeiling: "stated amounts + full balance where no amount was stated",
  arrearsUnderCommitment: "total arrears owed by committed accounts (not cash committed)",
  reached: "≥1 transcript with a genuine tenant turn (platform flags are not used)",
  cumulativeReach: "unique accounts counted at their first reach, never summed per round",
  reachByHour: "reached calls ÷ attempted calls, bucketed by hour in SAST (UTC+2)",
} as const;

export type ClassifiedResult = { classified: ClassifiedAccount[]; analytics: CampaignAnalytics };

export function classifyCampaign(accounts: ClassifiableAccount[]): ClassifiedResult {
  return { classified: accounts.map(classifyAccount), analytics: computeCampaignAnalytics(accounts) };
}
