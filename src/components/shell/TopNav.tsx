"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Navigation, as a row of words.
//
// This was four words, four bare icons, and a "More" button hiding another
// four pages. Two things were wrong with it.
//
// The More menu did nothing when clicked — not a dead handler, a clipped
// popover. The dock sits inside a horizontally scrolling wrapper, and CSS
// says that when one overflow axis is not `visible` the other computes to
// `auto` too: `overflow-x: auto` quietly gave the wrapper `overflow-y: auto`,
// so a menu positioned below the dock was cut off at the dock's own edge. It
// was rendering perfectly, one pixel out of sight.
//
// And the four bare icons were a quiz. An icon is worth using when the thing
// it stands for has a picture everybody already knows — a magnifying glass, a
// printer. "Promises to pay" has no such picture, so a small glyph is just a
// thing you hover to find out what it is, which is slower than reading a word.
//
// So: every place the work happens is a word in the row. What is left is
// set-up-and-forget, and lives under the account menu in the corner, which is
// not inside the scrolling wrapper and therefore actually opens.
// ---------------------------------------------------------------------------

const NAV = [
  { href: "/", label: "Home" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/debtors", label: "Debtors" },
  { href: "/calls", label: "Calls" },
  { href: "/analytics", label: "Analytics" },
  { href: "/promises", label: "Promises" },
  { href: "/payments", label: "Payments" },
  { href: "/escalations", label: "Escalations" },
] as const;

/** A demo session can only reach the analytics screen. */
const GUEST_NAV: readonly string[] = ["/analytics"];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * One lens of glass that follows the pointer along the dock.
 *
 * The alternative — every item lighting up on its own as the pointer crosses
 * it — reads as a row of switches. Handing a single highlight along makes the
 * dock feel like one object with something moving over it, which is the whole
 * reason a dock is a dock.
 *
 * It is done on the DOM rather than in state on purpose: this runs on every
 * pointer move, and re-rendering the row sixty times a second to move one
 * rectangle would cost more than the effect is worth.
 */
function useDockBubble(pathname: string) {
  const navRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);

  const place = useCallback((target: HTMLElement | null) => {
    const bubble = bubbleRef.current;
    const nav = navRef.current;
    if (!bubble || !nav) return;
    if (!target) {
      bubble.dataset.shown = "false";
      nav.dataset.riding = "false";
      return;
    }
    const from = nav.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    bubble.style.setProperty("--x", `${to.left - from.left}px`);
    bubble.style.setProperty("--w", `${to.width}px`);
    bubble.dataset.shown = "true";
    nav.dataset.riding = "true";
  }, []);

  /** Where it sits when nobody is pointing at anything. */
  const rest = useCallback(() => {
    const nav = navRef.current;
    place(nav?.querySelector<HTMLElement>('[aria-current="page"]') ?? null);
  }, [place]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Only once the script is running: without it the items keep their own
    // hover wash and the active one keeps its own pill.
    nav.dataset.bubble = "on";

    // A frame, so the dock has been laid out before anything is measured.
    const first = requestAnimationFrame(rest);

    const over = (event: PointerEvent) => {
      const item = (event.target as HTMLElement | null)?.closest<HTMLElement>(".dock-item");
      if (item && nav.contains(item)) place(item);
    };
    const leave = () => rest();
    const resize = () => rest();

    nav.addEventListener("pointermove", over);
    nav.addEventListener("pointerleave", leave);
    nav.addEventListener("focusin", over as EventListener);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(first);
      nav.removeEventListener("pointermove", over);
      nav.removeEventListener("pointerleave", leave);
      nav.removeEventListener("focusin", over as EventListener);
      window.removeEventListener("resize", resize);
    };
  }, [place, rest]);

  // A new page means a new resting place.
  useEffect(() => {
    const frame = requestAnimationFrame(rest);
    return () => cancelAnimationFrame(frame);
  }, [pathname, rest]);

  return { navRef, bubbleRef };
}

export function TopNav({ guest = false }: { guest?: boolean }) {
  const pathname = usePathname();
  const { navRef, bubbleRef } = useDockBubble(pathname);
  const items = guest ? NAV.filter((item) => GUEST_NAV.includes(item.href)) : NAV;

  return (
    <nav ref={navRef} className="dock relative max-w-full">
      <span ref={bubbleRef} className="dock-bubble" data-shown="false" aria-hidden />
      {items.map(({ href, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="dock-item shrink-0"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
