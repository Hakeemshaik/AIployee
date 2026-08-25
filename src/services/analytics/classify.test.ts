import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BUCKETS,
  classifyAccount,
  classifyCampaign,
  computeCampaignAnalytics,
  isReached,
  sastHour,
  summariseTranscript,
  type ClassifiableAccount,
} from "./classify";

const at = (iso: string) => new Date(iso);

function transcript(text: string, turns = 1) {
  return summariseTranscript("t", Array.from({ length: turns }, () => ({ role: "user", content: text })));
}

describe("reached detection", () => {
  it("requires a genuine tenant turn — platform flags are never used", () => {
    expect(isReached(transcript("Yes hello, I can pay on Friday"))).toBe(true);
    expect(isReached({ userTurns: 0, userText: "", userWords: 0 })).toBe(false);
  });

  it("treats a short machine greeting as not reached", () => {
    expect(isReached(transcript("The subscriber is not available"))).toBe(false);
    expect(isReached(transcript("Please leave a message after the tone"))).toBe(false);
    expect(isReached(transcript("mailbox is full"))).toBe(false);
  });

  it("still counts a real conversation that merely mentions a machine phrase", () => {
    const long =
      "Sorry I could not answer earlier my phone was switched off but I am here now and I can pay two thousand rand on Friday afternoon";
    expect(transcript(long).userWords).toBeGreaterThanOrEqual(15);
    expect(isReached(transcript(long))).toBe(true);
  });

  it("reads turn text from either content or text", () => {
    const s = summariseTranscript("t", [
      { role: "assistant", content: "Good day" },
      { role: "user", text: "I will pay" },
      { role: "user", content: "on Friday" },
    ]);
    expect(s.userTurns).toBe(2);
    expect(s.userWords).toBe(5);
    expect(s.userText).toBe("I will pay on Friday");
  });
});

describe("account classification", () => {
  const base = { phone: "+27821234567", balance: 5000 };

  it("classifies a real conversation", () => {
    const a = classifyAccount({
      ...base,
      accountId: "a",
      calls: [{ conversationUuid: "c1", durationSeconds: 120, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("Yes I can pay one thousand rand on Friday") }],
    });
    expect(a.bucket).toBe("conversation");
    expect(a.reached).toBe(true);
    expect(a.firstReachAttempt).toBe(1);
  });

  it("separates answered-few-words from conversation at 8 tenant words", () => {
    const seven = classifyAccount({
      ...base, accountId: "a",
      calls: [{ conversationUuid: "c", durationSeconds: 20, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("yes okay fine ring me back later") }],
    });
    expect(seven.tenantWords).toBe(7);
    expect(seven.bucket).toBe("answered_few_words");

    const eight = classifyAccount({
      ...base, accountId: "b",
      calls: [{ conversationUuid: "c", durationSeconds: 20, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("yes okay fine ring me back later tomorrow") }],
    });
    expect(eight.tenantWords).toBe(8);
    expect(eight.bucket).toBe("conversation");
  });

  it("classifies connected-but-no-conversation when talk time exists without a tenant turn", () => {
    const a = classifyAccount({
      ...base, accountId: "a",
      calls: [{ conversationUuid: "c", durationSeconds: 14, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("please leave a message") }],
    });
    expect(a.bucket).toBe("connected_no_conversation");
  });

  it("classifies dead numbers as never connected", () => {
    const a = classifyAccount({
      ...base, accountId: "a",
      calls: [
        { conversationUuid: "c1", durationSeconds: 0, startedAt: at("2026-08-19T09:00:00Z"), transcript: null },
        { conversationUuid: "c2", durationSeconds: 0, startedAt: at("2026-08-20T09:00:00Z"), transcript: null },
      ],
    });
    expect(a.bucket).toBe("never_connected");
    expect(a.attempts).toBe(2);
  });

  it("classifies an account with no calls as never called", () => {
    expect(classifyAccount({ ...base, accountId: "a", calls: [] }).bucket).toBe("never_called");
  });

  it("records the first reach attempt by time, not by provider order", () => {
    const a = classifyAccount({
      ...base, accountId: "a",
      calls: [
        // deliberately out of order, as the API returns them
        { conversationUuid: "c3", durationSeconds: 90, startedAt: at("2026-08-21T09:00:00Z"), transcript: transcript("Yes I will pay the full amount tomorrow morning") },
        { conversationUuid: "c1", durationSeconds: 0, startedAt: at("2026-08-19T09:00:00Z"), transcript: null },
        { conversationUuid: "c2", durationSeconds: 0, startedAt: at("2026-08-20T09:00:00Z"), transcript: null },
      ],
    });
    expect(a.firstReachAttempt).toBe(3);
    expect(a.firstReachAt?.toISOString()).toBe("2026-08-21T09:00:00.000Z");
  });
});

// The brief requires this assertion: buckets are mutually exclusive and total.
describe("buckets are exhaustive and mutually exclusive", () => {
  function book(): ClassifiableAccount[] {
    const accounts: ClassifiableAccount[] = [];
    const push = (n: number, make: (i: number) => ClassifiableAccount) => {
      for (let i = 0; i < n; i++) accounts.push(make(i));
    };
    push(40, (i) => ({
      accountId: `conv-${i}`, phone: "+27821111111", balance: 4000,
      calls: [{ conversationUuid: `c${i}`, durationSeconds: 130, startedAt: at("2026-08-19T11:00:00Z"), transcript: transcript("I can pay fifteen hundred rand this coming Friday afternoon") }],
      outcome: { ptpConfirmed: true, ptpAmount: 1500 },
    }));
    push(12, (i) => ({
      accountId: `few-${i}`, phone: "+27822222222", balance: 3000,
      calls: [{ conversationUuid: `f${i}`, durationSeconds: 18, startedAt: at("2026-08-19T13:00:00Z"), transcript: transcript("no thanks bye") }],
    }));
    push(23, (i) => ({
      accountId: `conn-${i}`, phone: "+27823333333", balance: 2500,
      calls: [{ conversationUuid: `x${i}`, durationSeconds: 9, startedAt: at("2026-08-19T15:00:00Z"), transcript: transcript("subscriber unavailable") }],
    }));
    push(31, (i) => ({
      accountId: `dead-${i}`, phone: "+27824444444", balance: 6000,
      calls: [{ conversationUuid: `d${i}`, durationSeconds: 0, startedAt: at("2026-08-19T10:00:00Z"), transcript: null }],
    }));
    push(14, (i) => ({ accountId: `none-${i}`, phone: "+27825555555", balance: 1000, calls: [] }));
    return accounts;
  }

  it("sums to the account total", () => {
    const accounts = book();
    const { analytics } = classifyCampaign(accounts);
    const sum = ACCOUNT_BUCKETS.reduce((s, b) => s + analytics.buckets[b], 0);
    expect(sum).toBe(accounts.length);
    expect(sum).toBe(120);
  });

  it("assigns each account exactly one bucket", () => {
    const { classified } = classifyCampaign(book());
    const counts = new Map<string, number>();
    for (const c of classified) counts.set(c.accountId, (counts.get(c.accountId) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
  });

  it("puts the expected number in each bucket", () => {
    const { analytics } = classifyCampaign(book());
    expect(analytics.buckets).toEqual({
      conversation: 40,
      answered_few_words: 12,
      connected_no_conversation: 23,
      never_connected: 31,
      never_called: 14,
    });
  });
});

describe("metrics are per account with the RPC denominator", () => {
  const accounts: ClassifiableAccount[] = [
    // one account dialled 6 times, reached once, with a promise
    {
      accountId: "a", phone: "+27821111111", balance: 10_000,
      calls: [
        ...Array.from({ length: 5 }, (_, i) => ({ conversationUuid: `a${i}`, durationSeconds: 0, startedAt: at(`2026-08-1${i + 1}T09:00:00Z`), transcript: null })),
        { conversationUuid: "a6", durationSeconds: 140, startedAt: at("2026-08-17T09:00:00Z"), transcript: transcript("Yes I will settle the arrears by month end please") },
      ],
      outcome: { ptpConfirmed: true, ptpAmount: 2000 },
    },
    // dead number, dialled twice
    {
      accountId: "b", phone: "+27822222222", balance: 5000,
      calls: [
        { conversationUuid: "b1", durationSeconds: 0, startedAt: at("2026-08-11T09:00:00Z"), transcript: null },
        { conversationUuid: "b2", durationSeconds: 0, startedAt: at("2026-08-12T09:00:00Z"), transcript: null },
      ],
    },
    // never called
    { accountId: "c", phone: "+27823333333", balance: 3000, calls: [] },
  ];

  it("computes penetration, RPC, dials per RPC and data-quality fail per account", () => {
    const m = computeCampaignAnalytics(accounts);
    expect(m.accounts).toBe(3);
    expect(m.calls).toBe(8);
    expect(m.attempted).toBe(2);
    expect(m.penetration).toBeCloseTo(2 / 3);
    expect(m.rpcRate).toBeCloseTo(1 / 3);
    expect(m.dialsPerRpc).toBeCloseTo(8);      // 8 calls / 1 conversation
    expect(m.dataQualityFailRate).toBeCloseTo(1 / 2); // 1 dead / 2 dialled
  });

  it("uses accounts-with-a-conversation as the PTP denominator, not calls or total accounts", () => {
    const m = computeCampaignAnalytics(accounts);
    expect(m.conversationAccounts).toBe(1);
    expect(m.ptpRate).toBeCloseTo(1);        // 1 promise / 1 RPC
    expect(m.ptpRate).not.toBeCloseTo(1 / 8); // not per call
    expect(m.ptpRate).not.toBeCloseTo(1 / 3); // not per account in book
  });
});

describe("commitment values are a floor and a ceiling", () => {
  const accounts: ClassifiableAccount[] = [
    {
      accountId: "stated", phone: "+27821111111", balance: 9000,
      calls: [{ conversationUuid: "s1", durationSeconds: 100, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("I will pay two thousand rand on the twenty fifth") }],
      outcome: { ptpConfirmed: true, ptpAmount: 2000 },
    },
    {
      accountId: "unstated", phone: "+27822222222", balance: 7000,
      calls: [{ conversationUuid: "u1", durationSeconds: 100, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("Yes I will sort out the account as soon as possible") }],
      outcome: { ptpConfirmed: true, ptpAmount: null },
    },
  ];

  it("puts unstated commitments at zero in the floor and full balance in the ceiling", () => {
    const { commitments } = computeCampaignAnalytics(accounts);
    expect(commitments.count).toBe(2);
    expect(commitments.withoutStatedAmount).toBe(1);
    expect(commitments.floor).toBe(2000);
    expect(commitments.ceiling).toBe(9000);
    expect(commitments.arrearsUnderCommitment).toBe(16_000);
  });

  it("keeps arrears under commitment separate from cash committed", () => {
    const { commitments } = computeCampaignAnalytics(accounts);
    // Conflating the two overstates the pipeline — here by 8x on the floor.
    expect(commitments.arrearsUnderCommitment).not.toBe(commitments.floor);
    expect(commitments.arrearsUnderCommitment).toBeGreaterThan(commitments.ceiling);
  });
});

describe("cumulative reach counts unique accounts at first reach", () => {
  it("never double-counts an account reached on a later round", () => {
    const accounts: ClassifiableAccount[] = [
      {
        accountId: "a", phone: "+27821111111", balance: 1000,
        calls: [
          { conversationUuid: "a1", durationSeconds: 0, startedAt: at("2026-08-19T09:00:00Z"), transcript: null },
          { conversationUuid: "a2", durationSeconds: 90, startedAt: at("2026-08-20T09:00:00Z"), transcript: transcript("Yes speaking I can pay next week sometime please") },
          // reached again on attempt 3 — must NOT be counted twice
          { conversationUuid: "a3", durationSeconds: 95, startedAt: at("2026-08-21T09:00:00Z"), transcript: transcript("Yes I already told you I will pay next week") },
        ],
      },
      {
        accountId: "b", phone: "+27822222222", balance: 1000,
        calls: [{ conversationUuid: "b1", durationSeconds: 80, startedAt: at("2026-08-19T09:00:00Z"), transcript: transcript("Hello yes this is the right person speaking now") }],
      },
    ];
    const m = computeCampaignAnalytics(accounts);
    const totalFirstReaches = m.reachByAttempt.reduce((s, r) => s + r.firstReached, 0);
    expect(totalFirstReaches).toBe(2); // two accounts, not three reaches
    expect(m.reachByAttempt.at(-1)?.cumulative).toBe(2);
    expect(m.reachByAttempt.at(-1)?.cumulativeRate).toBeCloseTo(1);
    expect(m.reachedAccounts).toBe(2);
  });
});

describe("hour-of-day is reported in SAST", () => {
  it("adds two hours to UTC", () => {
    expect(sastHour(at("2026-08-19T11:00:00Z"))).toBe(13);
    expect(sastHour(at("2026-08-19T13:00:00Z"))).toBe(15);
    expect(sastHour(at("2026-08-19T23:30:00Z"))).toBe(1);
  });

  it("buckets reach rate by SAST hour", () => {
    const accounts: ClassifiableAccount[] = [
      {
        accountId: "a", phone: "+27821111111", balance: 1000,
        calls: [
          { conversationUuid: "x1", durationSeconds: 5, startedAt: at("2026-08-19T11:00:00Z"), transcript: transcript("mailbox") },
          { conversationUuid: "x2", durationSeconds: 90, startedAt: at("2026-08-19T13:00:00Z"), transcript: transcript("Yes hello I can pay something on Friday for sure") },
        ],
      },
    ];
    const m = computeCampaignAnalytics(accounts);
    expect(m.reachByHour.find((h) => h.hour === 13)?.rate).toBe(0);
    expect(m.reachByHour.find((h) => h.hour === 15)?.rate).toBe(1);
  });
});
