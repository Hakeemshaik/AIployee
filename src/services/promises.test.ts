import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promiseDisplayStatus } from "./promises";
import { normalizePhone } from "./debtors";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-24T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("promiseDisplayStatus", () => {
  it("derives upcoming / due_today / overdue from the promised date", () => {
    expect(promiseDisplayStatus({ status: "pending", promisedDate: new Date("2026-08-28") })).toBe("upcoming");
    expect(promiseDisplayStatus({ status: "pending", promisedDate: new Date("2026-08-24T18:00:00Z") })).toBe("due_today");
    expect(promiseDisplayStatus({ status: "pending", promisedDate: new Date("2026-08-20") })).toBe("overdue");
  });

  it("passes resolved statuses through unchanged", () => {
    expect(promiseDisplayStatus({ status: "fulfilled", promisedDate: new Date("2026-08-20") })).toBe("fulfilled");
    expect(promiseDisplayStatus({ status: "broken", promisedDate: new Date("2026-08-28") })).toBe("broken");
    expect(promiseDisplayStatus({ status: "cancelled", promisedDate: new Date("2026-08-28") })).toBe("cancelled");
  });
});

describe("normalizePhone", () => {
  it("normalizes South African formats to E.164", () => {
    expect(normalizePhone("0821234567")).toBe("+27821234567");
    expect(normalizePhone("082 123 4567")).toBe("+27821234567");
    expect(normalizePhone("+27 82 123 4567")).toBe("+27821234567");
    expect(normalizePhone("27821234567")).toBe("+27821234567");
  });

  it("rejects invalid numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });
});
