import { describe, expect, it } from "vitest";
import {
  assertFilter,
  CONVERSATIONS_MAX_PAGE_SIZE,
  guardConversationFilters,
  JobixError,
  NO_DATA_SENTINELS,
  redact,
  unwrapBoolean,
  unwrapField,
  unwrapNumber,
} from "./client";

describe("customer field unwrapping", () => {
  it("unwraps the {value} envelope", () => {
    expect(unwrapField({ type: "string", value: "13893", previous_value: "" })).toBe("13893");
    expect(unwrapField("plain")).toBe("plain");
  });

  it("treats the empty-field sentinel as null", () => {
    for (const sentinel of NO_DATA_SENTINELS) {
      expect(unwrapField({ value: sentinel })).toBeNull();
      expect(unwrapField(sentinel)).toBeNull();
    }
  });

  it("treats any unresolved template placeholder as null", () => {
    expect(unwrapField({ value: "{{ attributes.unit_number }}" })).toBeNull();
    expect(unwrapField({ value: "{{ attributes.building_name }}" })).toBeNull();
  });

  it("treats blank and missing values as null", () => {
    expect(unwrapField({ value: "" })).toBeNull();
    expect(unwrapField({ value: "   " })).toBeNull();
    expect(unwrapField(null)).toBeNull();
    expect(unwrapField(undefined)).toBeNull();
  });

  it("parses numbers out of formatted strings", () => {
    expect(unwrapNumber({ value: "13893" })).toBe(13893);
    expect(unwrapNumber({ value: "R 13 893.50" })).toBeCloseTo(13893.5);
    expect(unwrapNumber({ value: "No data available" })).toBeNull();
  });

  it("reads yes/no flags", () => {
    expect(unwrapBoolean({ value: "Yes" })).toBe(true);
    expect(unwrapBoolean({ value: "true" })).toBe(true);
    expect(unwrapBoolean({ value: "No" })).toBe(false);
    expect(unwrapBoolean({ value: "No data available" })).toBe(false);
    expect(unwrapBoolean(undefined)).toBe(false);
  });
});

describe("conversation filter guard", () => {
  it("allows only the filters that actually filter", () => {
    expect(() => guardConversationFilters({ phone: "+27821234567" })).not.toThrow();
    expect(() => guardConversationFilters({ agents: "uuid" })).not.toThrow();
  });

  it("rejects the filters Jobix accepts and silently ignores", () => {
    for (const ignored of ["agent", "agent_uuid", "search", "query", "contact", "phones"]) {
      expect(() => guardConversationFilters({ [ignored]: "x" })).toThrow(JobixError);
    }
  });
});

describe("post-hoc filter verification", () => {
  it("passes when every row matches", () => {
    const rows = [{ phone: "+27821234567" }, { phone: "+27821234567" }];
    expect(assertFilter(rows, (r) => r.phone === "+27821234567", "phone")).toHaveLength(2);
  });

  it("throws when the API returned an unfiltered list that looks normal", () => {
    const rows = [{ phone: "+27821234567" }, { phone: "+27839999999" }];
    expect(() => assertFilter(rows, (r) => r.phone === "+27821234567", "phone")).toThrow(/ignored the phone filter/);
  });
});

describe("page size limits", () => {
  it("caps conversations at 50 because 100 returns HTTP 500", () => {
    expect(CONVERSATIONS_MAX_PAGE_SIZE).toBe(50);
  });
});

describe("credential redaction", () => {
  it("never lets a token reach a log or the UI", () => {
    const text = 'failed: {"Authorization":"Bearer abcdef1234567890xyz","company_key":"ck_live_9876543210"}';
    const safe = redact(text);
    expect(safe).not.toContain("abcdef1234567890xyz");
    expect(safe).not.toContain("ck_live_9876543210");
    expect(safe).toContain("[redacted]");
  });
});
