import { describe, expect, it } from "vitest";
import { PER_PAGE, pageParam, paginate } from "./paginate";

// ---------------------------------------------------------------------------
// The two things a pager has to get right: nothing is silently dropped, and a
// page number that no longer exists does not empty the screen.
// ---------------------------------------------------------------------------

const book = Array.from({ length: 2207 }, (_, i) => i + 1);

describe("paginate", () => {
  it("walks the whole list with nothing missing and nothing twice", () => {
    const seen: number[] = [];
    const { pageCount } = paginate(book, 1);
    for (let page = 1; page <= pageCount; page += 1) seen.push(...paginate(book, page).rows);
    expect(seen).toEqual(book);
  });

  it("reports the position a person can read", () => {
    const second = paginate(book, 2);
    expect(second).toMatchObject({ from: 51, to: 100, total: 2207, page: 2, pageCount: 45 });
  });

  it("gives the last page the remainder, not a full page", () => {
    const last = paginate(book, 45);
    expect(last.rows).toHaveLength(2207 % PER_PAGE);
    expect(last.to).toBe(2207);
  });

  it("shows the last page rather than nothing when a filter shortens the list", () => {
    // Somebody is on page 7 and then narrows the filter to twelve rows.
    const narrowed = paginate(book.slice(0, 12), 7);
    expect(narrowed).toMatchObject({ page: 1, pageCount: 1, from: 1, to: 12 });
    expect(narrowed.rows).toHaveLength(12);
  });

  it("says zero of zero rather than one of zero on an empty list", () => {
    expect(paginate([], 1)).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1 });
  });

  it("treats junk in the URL as page one", () => {
    for (const value of [undefined, "", "0", "-3", "2.5", "abc", "1e3x"]) {
      expect(pageParam(value)).toBe(1);
    }
    expect(pageParam("7")).toBe(7);
  });
});
