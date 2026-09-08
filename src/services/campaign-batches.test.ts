import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIZE,
  outstandingBalance,
  selectUnreleased,
  type SelectableContact,
} from "./campaign-batches";

// ---------------------------------------------------------------------------
// Batch selection decides who the dialler gets next, so the rule that matters
// is: a contact already sent must never appear in a later batch. These call
// the real selector rather than a copy of it, so the test cannot drift from
// the behaviour it is pinning.
// ---------------------------------------------------------------------------

type Contact = SelectableContact & { id: string };

function contact(id: string, over: Partial<Contact> = {}): Contact {
  return {
    id,
    redialBatchId: null,
    attempts: 0,
    debtor: { accounts: [{ currentBalance: 1000 }] },
    ...over,
  };
}

const balance = (amount: number) => ({ debtor: { accounts: [{ currentBalance: amount }] } });

describe("outstandingBalance", () => {
  it("sums every account on the debtor", () => {
    expect(
      outstandingBalance({
        redialBatchId: null,
        attempts: 0,
        debtor: { accounts: [{ currentBalance: 1500 }, { currentBalance: 2500 }] },
      }),
    ).toBe(4000);
  });

  it("is zero when the debtor has no accounts", () => {
    expect(outstandingBalance({ redialBatchId: null, attempts: 0, debtor: { accounts: [] } })).toBe(0);
  });
});

describe("selectUnreleased", () => {
  it("returns contacts that have never been sent", () => {
    const picked = selectUnreleased([contact("a"), contact("b"), contact("c")]);
    expect(picked.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("excludes contacts already stamped with a batch", () => {
    // This is the case attempts alone would miss: sent to the dialler, but no
    // result back yet, so attempts is still 0.
    const picked = selectUnreleased([
      contact("sent", { redialBatchId: "batch_1", attempts: 0 }),
      contact("waiting"),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["waiting"]);
  });

  it("excludes contacts that have already been called", () => {
    const picked = selectUnreleased([
      contact("called", { attempts: 1 }),
      contact("waiting"),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["waiting"]);
  });

  it("orders by outstanding balance, biggest first", () => {
    const picked = selectUnreleased([
      contact("small", balance(500)),
      contact("largest", balance(31000)),
      contact("middle", balance(7800)),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["largest", "middle", "small"]);
  });

  it("sums multiple accounts when ordering", () => {
    const picked = selectUnreleased([
      contact("one-big", balance(9000)),
      contact("two-small", {
        debtor: { accounts: [{ currentBalance: 6000 }, { currentBalance: 5000 }] },
      }),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["two-small", "one-big"]);
  });

  it("returns nothing once every contact has been released", () => {
    const picked = selectUnreleased([
      contact("a", { redialBatchId: "batch_1" }),
      contact("b", { attempts: 2 }),
    ]);
    expect(picked).toEqual([]);
  });

  it("does not mutate the input order", () => {
    const contacts = [contact("small", balance(100)), contact("big", balance(9000))];
    selectUnreleased(contacts);
    expect(contacts.map((c) => c.id)).toEqual(["small", "big"]);
  });
});

describe("batching a book into runs", () => {
  /** Release successive batches the way startNextBatch does. */
  function runBatches(pool: Contact[], size: number) {
    const batches: string[][] = [];
    let sequence = 0;
    // Bounded so a selection bug cannot spin forever.
    while (batches.length < 100) {
      const waiting = selectUnreleased(pool);
      if (waiting.length === 0) break;
      sequence += 1;
      const slice = waiting.slice(0, size);
      for (const c of slice) c.redialBatchId = `batch_${sequence}`;
      batches.push(slice.map((c) => c.id));
    }
    return batches;
  }

  it("splits a 553-contact book into batches of 150", () => {
    const pool = Array.from({ length: 553 }, (_, i) => contact(`c${i}`, balance(1000 + i)));
    const batches = runBatches(pool, DEFAULT_BATCH_SIZE);

    expect(batches.map((b) => b.length)).toEqual([150, 150, 150, 103]);
    // Nobody is dialled twice, and nobody is left behind.
    const all = batches.flat();
    expect(new Set(all).size).toBe(553);
    expect(all).toHaveLength(553);
  });

  it("puts the largest balances in the first batch", () => {
    const pool = Array.from({ length: 300 }, (_, i) => contact(`c${i}`, balance(i)));
    const [first] = runBatches(pool, DEFAULT_BATCH_SIZE);
    // Balances 299 down to 150 — the top 150.
    expect(first[0]).toBe("c299");
    expect(first).toHaveLength(150);
    expect(first).not.toContain("c149");
  });

  it("skips contacts already worked before batching existed", () => {
    const pool = [
      contact("legacy", { attempts: 2 }),
      ...Array.from({ length: 5 }, (_, i) => contact(`new${i}`)),
    ];
    const batches = runBatches(pool, DEFAULT_BATCH_SIZE);
    expect(batches).toHaveLength(1);
    expect(batches[0]).not.toContain("legacy");
    expect(batches[0]).toHaveLength(5);
  });

  it("stops cleanly when the book is empty", () => {
    expect(runBatches([], DEFAULT_BATCH_SIZE)).toEqual([]);
  });

  it("defaults to 150 per batch", () => {
    expect(DEFAULT_BATCH_SIZE).toBe(150);
  });
});
