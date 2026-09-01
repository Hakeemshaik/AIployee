// ---------------------------------------------------------------------------
// Pages, not an endless scroll.
//
// A book of three thousand accounts rendered as three thousand rows is a page
// nobody can find anything in: the browser is slow, the scrollbar is a hair,
// and "where was that account" has no answer but scrolling. Fifty at a time,
// with the count and the position stated, is a page you can navigate.
//
// The slicing is in memory, which matches how the list filters already work —
// several of them depend on values aggregated per debtor and are applied after
// the scoped fetch. When the book outgrows that, both move to SQL together;
// splitting them would give a page count that disagrees with the rows on it.
// ---------------------------------------------------------------------------

export const PER_PAGE = 50;

export type Paged<T> = {
  rows: T[];
  /** Everything that matched, not just this page. */
  total: number;
  page: number;
  pageCount: number;
  perPage: number;
  /** 1-based, inclusive, for "showing 51–100 of 2 207". */
  from: number;
  to: number;
};

/** `?page=3` → 3. Anything that is not a whole number above zero is page one. */
export function pageParam(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function paginate<T>(all: T[], page: number, perPage: number = PER_PAGE): Paged<T> {
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  // A page past the end shows the last one rather than nothing: a filter that
  // narrows the list while somebody is on page 7 should not empty the screen.
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * perPage;
  const rows = all.slice(start, start + perPage);
  return {
    rows,
    total,
    page: current,
    pageCount,
    perPage,
    from: total === 0 ? 0 : start + 1,
    to: start + rows.length,
  };
}
