"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Bot,
  CalendarClock,
  FileText,
  LayoutDashboard,
  Menu,
  PhoneCall,
  Radar,
  ScanSearch,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { BrandLockup } from "@/components/Brand";

// ---------------------------------------------------------------------------
// Navigation.
//
// Twelve links in one undifferentiated column meant reading all twelve to find
// one. They are the same twelve, in four groups that answer a different
// question each: what am I running, what did it do, what does it mean, and how
// is it set up.
// ---------------------------------------------------------------------------

const GROUPS = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/campaigns", label: "Campaigns", icon: Radar },
      { href: "/debtors", label: "Debtors", icon: Users },
    ],
  },
  {
    label: "Results",
    items: [
      { href: "/calls", label: "Calls", icon: PhoneCall },
      { href: "/analytics", label: "Call analytics", icon: ScanSearch },
      { href: "/promises", label: "Promises to pay", icon: CalendarClock },
      { href: "/payments", label: "Payments", icon: Banknote },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/insights", label: "AI insights", icon: Sparkles },
      { href: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/escalations", label: "Escalations", icon: AlertTriangle },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

/** A demo session can only reach the analytics screen. */
const GUEST_NAV: readonly string[] = ["/analytics"];

function NavLinks({ onNavigate, guest }: { onNavigate?: () => void; guest: boolean }) {
  const pathname = usePathname();
  const groups = guest
    ? GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => GUEST_NAV.includes(item.href)),
      })).filter((group) => group.items.length > 0)
    : GROUPS;

  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[0.5625rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
            {group.label}
          </p>
          <div className="flex flex-col gap-px">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-3 text-[0.8125rem] transition-colors ${
                    active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
                  }`}
                >
                  {/* The teal rule marking where you are. It is the only thing
                      on the screen that moves between pages. */}
                  <span
                    className={`nav-mark absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent ${
                      active ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    className={active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}
                  />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ guest = false }: { guest?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col gap-6 border-r border-line bg-plane py-5 lg:flex">
        <Link href="/" className="px-3">
          <BrandLockup />
        </Link>
        <div className="flex-1 overflow-y-auto px-2">
          <NavLinks guest={guest} />
        </div>
        {guest && (
          <p className="px-5 text-[0.6875rem] leading-relaxed text-ink-3">
            Demo session. Sign in to reach the rest.
          </p>
        )}
      </aside>

      {/* Mobile */}
      <button
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-3.5 z-40 rounded-lg border border-line bg-panel p-2 text-ink-2 lg:hidden"
      >
        <Menu size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="page-in absolute inset-y-0 left-0 flex w-[264px] flex-col gap-6 border-r border-line bg-plane py-5">
            <div className="flex items-center justify-between pl-3 pr-3">
              <Link href="/" onClick={() => setOpen(false)}>
                <BrandLockup />
              </Link>
              <button
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-ink-3 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              <NavLinks guest={guest} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
