import { describe, expect, it, vi } from "vitest";
import { verifySignature } from "@/services/integrations/jobix-webhook";
import { mapOutcome, mapStatus } from "@/services/integrations/outcome-mapping";

// ---------------------------------------------------------------------------
// Redial selection is the platform's most important guarantee: a redial batch
// must contain ONLY the contacts matching its filter. The selection logic is
// exercised here against an in-memory contact set so the rule is pinned
// without needing a database.
// ---------------------------------------------------------------------------

type TestContact = {
  id: string;
  attempts: number;
  lastOutcome: string | null;
  callbackAt?: Date | null;
  debtorStatus?: string;
  doNotContact?: boolean;
  balance?: number;
  phone?: string;
};

const FILTER_OUTCOMES: Record<string, string[]> = {
  no_answer: ["no_answer", "voicemail"],
  busy: ["busy"],
  failed: ["failed"],
  callback_due: ["callback_requested"],
};

const UNDIALLABLE = ["paid", "opted_out", "dispute", "escalated", "legal", "uncontactable"];

/** Mirrors the production selection rules in services/redial.ts. */
function select(contacts: TestContact[], filter: string, maxRetries: number, now = new Date()) {
  const dialable = contacts.filter((c) => {
    if (c.doNotContact) return false;
    if (UNDIALLABLE.includes(c.debtorStatus ?? "active")) return false;
    if (!/^\+\d{8,15}$/.test(c.phone ?? "+27821234567")) return false;
    if ((c.balance ?? 1000) <= 0) return false;
    return true;
  });
  const matched = dialable.filter((c) => {
    if (!c.lastOutcome || !FILTER_OUTCOMES[filter].includes(c.lastOutcome)) return false;
    if (filter === "callback_due" && c.callbackAt && c.callbackAt > now) return false;
    return true;
  });
  return matched.filter((c) => c.attempts < maxRetries);
}

function buildCampaign(): TestContact[] {
  const contacts: TestContact[] = [];
  // 147 genuine no-answers
  for (let i = 0; i < 147; i++) {
    contacts.push({ id: `na-${i}`, attempts: 1, lastOutcome: "no_answer" });
  }
  // 853 contacts that must NOT be redialled
  for (let i = 0; i < 400; i++) contacts.push({ id: `ptp-${i}`, attempts: 1, lastOutcome: "promise_to_pay" });
  for (let i = 0; i < 200; i++) contacts.push({ id: `busy-${i}`, attempts: 1, lastOutcome: "busy" });
  for (let i = 0; i < 100; i++) contacts.push({ id: `none-${i}`, attempts: 0, lastOutcome: null });
  for (let i = 0; i < 153; i++) contacts.push({ id: `nc-${i}`, attempts: 2, lastOutcome: "no_commitment" });
  return contacts;
}

describe("redial selection", () => {
  it("sends only the no-answer contacts, never the whole campaign", () => {
    const contacts = buildCampaign();
    expect(contacts).toHaveLength(1000);

    const selected = select(contacts, "no_answer", 3);

    expect(selected).toHaveLength(147);
    expect(selected).not.toHaveLength(contacts.length);
    expect(selected.every((c) => c.lastOutcome === "no_answer")).toBe(true);
  });

  it("counts voicemail as a no-answer but busy separately", () => {
    const contacts: TestContact[] = [
      { id: "a", attempts: 1, lastOutcome: "no_answer" },
      { id: "b", attempts: 1, lastOutcome: "voicemail" },
      { id: "c", attempts: 1, lastOutcome: "busy" },
    ];
    expect(select(contacts, "no_answer", 3).map((c) => c.id)).toEqual(["a", "b"]);
    expect(select(contacts, "busy", 3).map((c) => c.id)).toEqual(["c"]);
  });

  it("excludes contacts that have hit the retry limit", () => {
    const contacts: TestContact[] = [
      { id: "fresh", attempts: 0, lastOutcome: "no_answer" },
      { id: "second", attempts: 2, lastOutcome: "no_answer" },
      { id: "maxed", attempts: 3, lastOutcome: "no_answer" },
      { id: "over", attempts: 9, lastOutcome: "no_answer" },
    ];
    expect(select(contacts, "no_answer", 3).map((c) => c.id)).toEqual(["fresh", "second"]);
  });

  it("excludes suppressed and settled accounts even when the outcome matches", () => {
    const contacts: TestContact[] = [
      { id: "ok", attempts: 1, lastOutcome: "no_answer" },
      { id: "dnc", attempts: 1, lastOutcome: "no_answer", doNotContact: true },
      { id: "paid", attempts: 1, lastOutcome: "no_answer", debtorStatus: "paid" },
      { id: "opted", attempts: 1, lastOutcome: "no_answer", debtorStatus: "opted_out" },
      { id: "dispute", attempts: 1, lastOutcome: "no_answer", debtorStatus: "dispute" },
      { id: "settled", attempts: 1, lastOutcome: "no_answer", balance: 0 },
      { id: "badnum", attempts: 1, lastOutcome: "no_answer", phone: "12345" },
    ];
    expect(select(contacts, "no_answer", 3).map((c) => c.id)).toEqual(["ok"]);
  });

  it("only runs callbacks whose requested time has passed", () => {
    const now = new Date("2026-08-25T12:00:00Z");
    const contacts: TestContact[] = [
      { id: "due", attempts: 1, lastOutcome: "callback_requested", callbackAt: new Date("2026-08-25T09:00:00Z") },
      { id: "later", attempts: 1, lastOutcome: "callback_requested", callbackAt: new Date("2026-08-25T18:00:00Z") },
      { id: "unspecified", attempts: 1, lastOutcome: "callback_requested", callbackAt: null },
    ];
    expect(select(contacts, "callback_due", 3, now).map((c) => c.id)).toEqual(["due", "unspecified"]);
  });

  it("returns nothing when no contact matches, rather than falling back to everyone", () => {
    const contacts: TestContact[] = [
      { id: "a", attempts: 1, lastOutcome: "promise_to_pay" },
      { id: "b", attempts: 1, lastOutcome: "no_commitment" },
    ];
    expect(select(contacts, "no_answer", 3)).toHaveLength(0);
  });
});

describe("provider outcome mapping", () => {
  it("maps provider results onto internal outcomes", () => {
    expect(mapOutcome("promise_to_pay")).toBe("promise_to_pay");
    expect(mapOutcome("PTP")).toBe("promise_to_pay");
    expect(mapOutcome("Payment Promised")).toBe("promise_to_pay");
    expect(mapOutcome("callback")).toBe("callback_requested");
    expect(mapOutcome("wrong-person")).toBe("wrong_number");
    expect(mapOutcome("cannot afford")).toBe("financial_hardship");
  });

  it("returns null for unknown results so AI analysis decides instead of guessing", () => {
    expect(mapOutcome("something_new_from_the_provider")).toBeNull();
    expect(mapOutcome(null)).toBeNull();
    expect(mapOutcome("")).toBeNull();
  });

  it("maps provider call statuses", () => {
    expect(mapStatus("answered")).toBe("completed");
    expect(mapStatus("NO-ANSWER")).toBe("no_answer");
    expect(mapStatus("busy")).toBe("busy");
    expect(mapStatus("machine")).toBe("voicemail");
    expect(mapStatus("error")).toBe("failed");
    expect(mapStatus(null)).toBe("failed");
  });
});

describe("webhook signature verification", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ event: "call.completed", id: "evt_1" });

  it("accepts a correct hex signature", async () => {
    const { createHmac } = await import("crypto");
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body, `sha256=${sig}`, secret)).toBe(true);
  });

  it("accepts a correct base64 signature", async () => {
    const { createHmac } = await import("crypto");
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("rejects a wrong signature, a wrong secret, a tampered body and a missing header", async () => {
    const { createHmac } = await import("crypto");
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifySignature(body, "deadbeef", secret)).toBe(false);
    expect(verifySignature(body, sig, "other_secret")).toBe(false);
    expect(verifySignature(body + " ", sig, secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
  });
});

describe("in-flight call detection", () => {
  it("treats only recent unfinished calls as currently calling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"));
    const window = 5 * 60_000;
    const calls = [
      { startedAt: new Date("2026-08-25T11:59:00Z"), endedAt: null },
      { startedAt: new Date("2026-08-25T11:40:00Z"), endedAt: null },
      { startedAt: new Date("2026-08-25T11:59:30Z"), endedAt: new Date("2026-08-25T11:59:50Z") },
    ];
    const inFlight = calls.filter((c) => !c.endedAt && Date.now() - c.startedAt.getTime() < window);
    expect(inFlight).toHaveLength(1);
    vi.useRealTimers();
  });
});
