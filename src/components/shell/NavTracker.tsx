"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Counting our own steps.
//
// document.referrer never changes on a client-side navigation, so it cannot
// answer "did this person arrive here from inside the app". This counts route
// changes in sessionStorage instead: mounted once in the shell, it ticks on
// every pathname or query change, and BackLink asks it whether the previous
// history entry is one of ours.
//
// sessionStorage on purpose: it survives a reload of the same tab (where
// history still holds the earlier pages) and starts fresh in a new tab (where
// it does not).
// ---------------------------------------------------------------------------

const KEY = "aip:route-visits";

export function visitedInside(): boolean {
  try {
    return Number(sessionStorage.getItem(KEY) ?? "0") > 1 && window.history.length > 1;
  } catch {
    return false;
  }
}

export function NavTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const last = useRef<string | null>(null);

  useEffect(() => {
    const here = `${pathname}?${query}`;
    // React can re-run the effect without a navigation having happened;
    // only an actual change of address is a step.
    if (last.current === here) return;
    last.current = here;
    try {
      sessionStorage.setItem(KEY, String(Number(sessionStorage.getItem(KEY) ?? "0") + 1));
    } catch {
      // Storage blocked — BackLink falls back to its href, which still works.
    }
  }, [pathname, query]);

  return null;
}
