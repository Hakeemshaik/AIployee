import { describe, expect, it } from "vitest";
import { csvToObjects, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('name,notes\n"van der Merwe, Piet","said ""maybe"""')).toEqual([
      ["name", "notes"],
      ["van der Merwe, Piet", 'said "maybe"'],
    ]);
  });

  it("handles CRLF and skips blank lines", () => {
    expect(parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});

describe("csvToObjects", () => {
  it("maps rows to objects keyed by normalized headers", () => {
    const rows = csvToObjects("First Name,Account Number\nThandi,EDG-1001");
    expect(rows).toEqual([{ firstname: "Thandi", accountnumber: "EDG-1001" }]);
  });

  it("returns empty for header-only input", () => {
    expect(csvToObjects("a,b,c")).toEqual([]);
  });
});
