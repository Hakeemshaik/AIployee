"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Banknote, CalendarClock, PhoneCall, UserRound } from "lucide-react";

// ---------------------------------------------------------------------------
// The rooms of Collections.
//
// Calls, promises, payments and escalations share one entry in the navigation,
// and this bar is how you move between them once you are inside. It sits at
// the top of each of the four pages, so switching from "what did the calls do"
// to "what did they promise" is one click that keeps you where you were.
//
// The order is the order of the money: the call happens, a promise is made, a
// payment lands — and escalations are the ones that fell out of that line.
// ---------------------------------------------------------------------------

const ROOMS = [
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/promises", label: "Promises", icon: CalendarClock },
  { href: "/payments", label: "Payments", icon: Banknote },
  { href: "/escalations", label: "Escalations", icon: UserRound },
] as const;

export function CollectionsTabs() {
  const pathname = usePathname();
  return (
    <nav className="dock mb-5 inline-flex" aria-label="Collections sections">
      {ROOMS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="dock-item shrink-0"
          >
            <Icon size={14} strokeWidth={1.9} className={active ? "text-accent" : "text-ink-3"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
