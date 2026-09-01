"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Bot,
  CalendarClock,
  ChevronDown,
  FileText,
  LayoutDashboard,
  PhoneCall,
  Radar,
  ScanSearch,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Navigation, in one row.
//
// A column down the left held twelve links, four group headings and a lot of
// air — a permanent 236px of navigation for a screen whose job is data. The
// same twelve now sit in the header: the four places the work happens are
// labelled pills, the four that answer "what happened" are icons, and the
// four that are set-up-and-forget live behind More.
//
// The split is by how often a thing is opened, not by category. Dashboard,
// Campaigns, Debtors and Calls are opened daily and read as words. Analytics,
// Promises, Payments and Insights are opened when a question comes up and are
// recognisable by their icon. Reports, Agents, Escalations and Settings are
// opened when something needs changing, which is rarely, and can afford a
// click.
// ---------------------------------------------------------------------------

const PRIMARY = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Radar },
  { href: "/debtors", label: "Debtors", icon: Users },
  { href: "/calls", label: "Calls", icon: PhoneCall },
] as const;

const QUICK = [
  { href: "/analytics", label: "Call analytics", icon: ScanSearch },
  { href: "/promises", label: "Promises to pay", icon: CalendarClock },
  { href: "/payments", label: "Payments", icon: Banknote },
  { href: "/insights", label: "AI insights", icon: Sparkles },
] as const;

const MORE = [
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/escalations", label: "Escalations", icon: AlertTriangle },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** A demo session can only reach the analytics screen. */
const GUEST_NAV: readonly string[] = ["/analytics"];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function TopNav({ guest = false }: { guest?: boolean }) {
  const pathname = usePathname();
  const [openMore, setOpenMore] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  // Close on a click anywhere else and on Escape — a menu that only closes by
  // clicking its own button is a menu people leave open.
  useEffect(() => {
    if (!openMore) return;
    const away = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setOpenMore(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMore(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [openMore]);

  const primary = guest ? [] : PRIMARY;
  const quick = guest ? QUICK.filter((item) => GUEST_NAV.includes(item.href)) : QUICK;
  const more = guest ? [] : MORE;
  const moreActive = more.some((item) => isActive(pathname, item.href));

  return (
    <nav className="dock max-w-full">
      {/* The daily four, as words. */}
      {primary.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="dock-item shrink-0"
          >
            <Icon size={15} strokeWidth={1.9} className={active ? "text-accent" : "text-ink-3"} />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}

      {primary.length > 0 && quick.length > 0 && (
        <span className="dock-divider hidden md:block" aria-hidden />
      )}

      {/* The four that answer a question, as icons with their name on hover. */}
      <span className="hidden items-center gap-1 md:flex">
        {quick.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="dock-item dock-icon"
            >
              <Icon size={16} strokeWidth={1.9} className={active ? "text-accent" : "text-ink-3"} />
            </Link>
          );
        })}
      </span>

      {more.length > 0 && (
        <div className="relative shrink-0" ref={moreRef}>
          <button
            onClick={() => setOpenMore((open) => !open)}
            aria-expanded={openMore}
            aria-haspopup="menu"
            aria-current={moreActive ? "page" : undefined}
            className="dock-item"
          >
            <span className="hidden sm:inline">More</span>
            <ChevronDown
              size={14}
              className={`text-ink-3 transition-transform duration-200 ${openMore ? "rotate-180" : ""}`}
            />
          </button>
          {openMore && (
            <div className="card-float page-in absolute right-0 top-[calc(100%+0.75rem)] z-50 w-56 p-1.5">
              {more.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpenMore(false)}
                    className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-[0.8125rem] transition-colors ${
                      active ? "bg-accent/10 text-ink" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.85} className={active ? "text-accent" : "text-ink-3"} />
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
