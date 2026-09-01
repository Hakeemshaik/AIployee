"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { count } from "@/lib/format";

// ---------------------------------------------------------------------------
// Moving between pages.
//
// It says where you are in words before it offers a button — "51–100 of 2 207"
// answers the question people actually have, which is how much of the book they
// are looking at. The numbered buttons are for jumping; the arrows are for
// reading straight through, and are also what the left and right arrow keys do
// when nothing is focused.
//
// The page number lives in the URL, so a page can be linked, bookmarked and
// gone back to. Nothing here fetches — it replaces the query string and the
// server component re-renders.
// ---------------------------------------------------------------------------

/** 1 … 4 5 [6] 7 8 … 44 — the ends, the neighbours, and gaps for the rest. */
function windowed(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const near = new Set([1, pageCount, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => near.add(n));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => near.add(n));
  const pages = [...near].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function Pager({
  page,
  pageCount,
  total,
  from,
  to,
  /** What is being counted: "accounts", "calls", "promises". */
  noun,
  /**
   * Pass this and the pager stops touching the URL and calls you instead —
   * for a list that is filtered in the browser, where the page number is not
   * something the server knows about.
   */
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  noun: string;
  onPage?: (page: number) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function go(next: number) {
    if (next < 1 || next > pageCount || next === page) return;
    if (onPage) {
      onPage(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const query = new URLSearchParams(params.toString());
    if (next === 1) query.delete("page");
    else query.set("page", String(next));
    const suffix = query.toString();
    startTransition(() => router.replace(suffix ? `${pathname}?${suffix}` : pathname));
    // Back to the top of the list — landing on page 4 half way down it is
    // disorienting, and the rows underneath are different ones.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Left and right move a page, as long as nothing is being typed into.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowLeft") go(page - 1);
      if (event.key === "ArrowRight") go(page + 1);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  if (total === 0) return null;

  const arrow =
    "flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white/60 text-ink-2 transition-all hover:border-accent/45 hover:bg-white hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-white/60";

  return (
    <nav
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
      aria-label={`${noun} pages`}
    >
      <p className="flex items-center gap-2 text-[0.75rem] text-ink-3">
        {pending && <Loader2 size={12} className="animate-spin text-accent" />}
        <span>
          <span className="num font-medium text-ink">
            {count(from)}–{count(to)}
          </span>{" "}
          of <span className="num font-medium text-ink">{count(total)}</span> {noun}
        </span>
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => go(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
            className={arrow}
          >
            <ChevronLeft size={15} />
          </button>
          {windowed(page, pageCount).map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-[0.75rem] text-ink-3" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={entry}
                onClick={() => go(entry)}
                aria-current={entry === page ? "page" : undefined}
                aria-label={`Page ${entry}`}
                className={`num h-8 min-w-8 rounded-full px-2.5 text-[0.75rem] transition-all ${
                  entry === page
                    ? "bg-ink font-semibold text-base shadow-[0_6px_14px_-8px_rgba(21,32,46,0.9)]"
                    : "border border-line bg-white/60 text-ink-2 hover:border-accent/45 hover:bg-white hover:text-ink"
                }`}
              >
                {entry}
              </button>
            ),
          )}
          <button
            onClick={() => go(page + 1)}
            disabled={page === pageCount}
            aria-label="Next page"
            className={arrow}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </nav>
  );
}
