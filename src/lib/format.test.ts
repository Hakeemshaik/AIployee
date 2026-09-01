import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatTime,
  money,
  moneyExact,
  percent,
 count,} from "./format";

// ---------------------------------------------------------------------------
// These are cross-environment invariants, not cosmetics. Intl's en-ZA output
// differs between Node's ICU and Chromium's, and the server runs in UTC while
// users are in SAST — so unpinned formatting produced wrong times on
// server-rendered pages and made React discard the server tree on hydration.
// ---------------------------------------------------------------------------

describe("money", () => {
  it("groups thousands with a space, independent of the platform's ICU", () => {
    expect(money(950)).toBe("R 950");
    expect(money(1250)).toBe("R 1 250");
    expect(money(271950)).toBe("R 271 950");
    expect(money(1234567)).toBe("R 1 234 567");
  });

  it("contains no comma and no no-break space — the two ICU variants", () => {
    const rendered = money(1234567);
    expect(rendered).not.toContain(",");
    expect(rendered).not.toContain(" ");
  });

  it("rounds before grouping", () => {
    expect(money(999.6)).toBe("R 1 000");
    expect(money(1250.4)).toBe("R 1 250");
  });

  it("puts the sign before the currency symbol", () => {
    expect(money(-1200)).toBe("-R 1 200");
    expect(money(-45.75)).toBe("-R 46");
  });

  it("renders zero and null distinctly", () => {
    expect(money(0)).toBe("R 0");
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
  });
});

describe("moneyExact", () => {
  it("shows cents after a comma, grouped with spaces", () => {
    expect(moneyExact(1250.5)).toBe("R 1 250,50");
    expect(moneyExact(271950)).toBe("R 271 950,00");
    expect(moneyExact(45.75)).toBe("R 45,75");
    expect(moneyExact(-45.75)).toBe("-R 45,75");
  });

  it("never emits a full stop as the decimal separator", () => {
    expect(moneyExact(1250.5)).not.toContain(".");
  });
});

describe("date formatting", () => {
  // 18:30 UTC is 20:30 SAST — the case that was displaying two hours early.
  const evening = new Date("2026-08-17T18:30:00.000Z");

  it("renders South African time regardless of the machine's zone", () => {
    expect(formatTime(evening)).toBe("20:30");
    expect(formatDateTime(evening)).toBe("17 Aug 2026, 20:30");
    expect(formatDate(evening)).toBe("17 Aug 2026");
  });

  it("rolls the date over at SAST midnight, not UTC midnight", () => {
    // 22:15 UTC on the 17th is 00:15 on the 18th in Johannesburg.
    const lateNight = new Date("2026-08-17T22:15:00.000Z");
    expect(formatDate(lateNight)).toBe("18 Aug 2026");
    expect(formatDateTime(lateNight)).toBe("18 Aug 2026, 00:15");
  });

  it("renders midnight as 00:00, never 24:00", () => {
    expect(formatTime(new Date("2026-08-17T22:00:00.000Z"))).toBe("00:00");
  });

  it("accepts ISO strings as well as Date objects", () => {
    expect(formatDateTime("2026-08-17T18:30:00.000Z")).toBe("17 Aug 2026, 20:30");
  });

  it("returns a dash for missing or unparseable input instead of Invalid Date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatTime("not a date")).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("percent", () => {
  it("formats a ratio to one decimal by default", () => {
    expect(percent(0.2578)).toBe("25.8%");
    expect(percent(0.2578, 0)).toBe("26%");
    expect(percent(null)).toBe("—");
    expect(percent(Number.NaN)).toBe("—");
  });
});

describe("count", () => {
  it("groups with a space, matching money", () => {
    expect(count(2700)).toBe("2 700");
    expect(count(1220)).toBe("1 220");
    expect(count(999)).toBe("999");
    expect(count(1_234_567)).toBe("1 234 567");
  });

  it("is stable regardless of the ICU build, unlike toLocaleString", () => {
    // The whole point: no separator may come from the platform's locale data,
    // because Node and Chromium disagree on en-ZA grouping.
    expect(count(2700)).not.toContain(",");
    expect(count(2700)).not.toContain("\u00a0");
  });

  it("handles zero, negatives and nothing", () => {
    expect(count(0)).toBe("0");
    expect(count(-4200)).toBe("-4 200");
    expect(count(null)).toBe("—");
    expect(count(undefined)).toBe("—");
    expect(count(NaN)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// The four-letter month.
//
// `toLocaleDateString(… { month: "short" })` returns "Sept" for September in
// every English locale ICU ships, and only for September. It has already
// broken a batch code in this codebase; these walk all twelve so it cannot
// come back through a date shown on a screen either.
// ---------------------------------------------------------------------------

describe("short months are always three letters", () => {
  const expected = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  it("formats every month of the year", () => {
    expected.forEach((month, index) => {
      // Midday, so the SAST conversion cannot roll the date into another month.
      const date = new Date(Date.UTC(2026, index, 15, 12, 0, 0));
      expect(formatDayMonth(date)).toBe(`15 ${month}`);
      expect(formatDate(date)).toBe(`15 ${month} 2026`);
    });
  });

  it("says nothing rather than 'Invalid Date' when there is no date", () => {
    expect(formatDayMonth(null)).toBe("—");
    expect(formatDayMonth(undefined)).toBe("—");
  });
});
