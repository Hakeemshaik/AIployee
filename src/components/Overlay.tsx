"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Anything that covers the screen goes through here.
//
// `position: fixed` is only relative to the window while no ancestor has a
// transform, a filter, a backdrop-filter or a perspective — any one of those
// makes that ancestor the containing block instead, and `inset-0` silently
// starts meaning "the size of that div". This app is built out of glass, so
// nearly every card has a backdrop-filter, and every page wrapper animates in.
// A drawer three thousand pixels tall, hanging off the top of the window, was
// the result.
//
// Rendering to <body> makes that impossible by construction rather than by
// remembering. It is one line at each call site and it removes a whole class of
// bug that only shows up on the screens where it matters most.
//
// It renders nothing on the server: an overlay is always opened by somebody, so
// there is nothing to see on the first paint, and portalling during SSR is not
// available anyway.
// ---------------------------------------------------------------------------

/** Nothing to subscribe to — the answer is different on each side and never
 *  changes after that, which is exactly what the two snapshots are for. */
const NEVER_CHANGES = () => () => {};

export function Overlay({ children }: { children: ReactNode }) {
  const onClient = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );
  if (!onClient) return null;
  return createPortal(children, document.body);
}
