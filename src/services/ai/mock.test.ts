import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockProvider } from "./mock";

const debtor = { name: "Sipho Nkosi", outstandingBalance: 4850, daysOverdue: 45 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-24T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("mock transcript analysis", () => {
  it("extracts a promise to pay with amount and date", async () => {
    const result = await mockProvider.analyzeCallTranscript({
      transcript:
        "Agent (AI): Good day, this call is recorded.\nSipho: Things are tight but I get paid on the 25th. I'll pay R1,500 on 28 August.",
      callStatus: "completed",
      debtor,
    });
    expect(result.outcome).toBe("promise_to_pay");
    expect(result.promised_amount).toBe(1500);
    expect(result.promised_date).toBe("2026-08-28");
    expect(result.requires_human).toBe(false);
    expect(result.next_action).toBe("follow_up_before_promised_date");
  });

  it("flags disputes for human review", async () => {
    const result = await mockProvider.analyzeCallTranscript({
      transcript: "Sipho: This is not my debt. I never opened an account with them.",
      callStatus: "completed",
      debtor,
    });
    expect(result.outcome).toBe("dispute");
    expect(result.requires_human).toBe(true);
    expect(result.escalation_reason).toBe("dispute");
  });

  it("records opt-outs with suppress_contact next action", async () => {
    const result = await mockProvider.analyzeCallTranscript({
      transcript: "Sipho: Stop calling me. Do not contact me again on this number.",
      callStatus: "completed",
      debtor,
    });
    expect(result.outcome).toBe("opted_out");
    expect(result.next_action).toBe("suppress_contact");
  });

  it("treats unanswered calls as no_answer regardless of transcript", async () => {
    const result = await mockProvider.analyzeCallTranscript({
      transcript: "",
      callStatus: "no_answer",
      debtor,
    });
    expect(result.outcome).toBe("no_answer");
    expect(result.next_action).toBe("retry_within_campaign_rules");
  });

  it("prefers the voice platform's reported outcome when supplied", async () => {
    const result = await mockProvider.analyzeCallTranscript({
      transcript: "Sipho: I'll pay you next week.",
      callStatus: "completed",
      reportedOutcome: "payment_arrangement",
      debtor,
    });
    expect(result.outcome).toBe("payment_arrangement");
  });
});
