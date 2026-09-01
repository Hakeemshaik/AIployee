"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Banknote,
  Bot,
  CalendarClock,
  FileText,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  Radar,
  ScanSearch,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { BrandLockup, BrandMark } from "@/components/Brand";

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

// ---------------------------------------------------------------------------
// Collapsed to a rail, the analytics get 168px more width — on a laptop that is
// the difference between a chart you read and one you squint at. The choice is
// remembered, because re-collapsing it every morning is the sort of small tax
// that makes a tool annoying to live with.
//
// Read through the store rather than an effect: the server has no localStorage,
// both toggle buttons stay in step, and a browser with storage blocked simply
// gets the full sidebar.
// ---------------------------------------------------------------------------

const RAIL_KEY = "aiployee.nav.rail";
const RAIL_EVENT = "aiployee:nav-rail";

function subscribeRail(onChange: () => void) {
  window.addEventListener(RAIL_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RAIL_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readRail(): boolean {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

function useRail(): boolean {
  return useSyncExternalStore(subscribeRail, readRail, () => false);
}

function toggleRail() {
  try {
    window.localStorage.setItem(RAIL_KEY, readRail() ? "0" : "1");
  } catch {
    // Not worth failing a click over — the sidebar just will not remember.
  }
  window.dispatchEvent(new Event(RAIL_EVENT));
}

function NavLinks({
  onNavigate,
  guest,
  rail = false,
}: {
  onNavigate?: () => void;
  guest: boolean;
  /** Icons only. The labels come back as a tooltip on hover. */
  rail?: boolean;
}) {
  const pathname = usePathname();
  const groups = guest
    ? GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => GUEST_NAV.includes(item.href)),
      })).filter((group) => group.items.length > 0)
    : GROUPS;

  return (
    <nav className={`flex flex-col ${rail ? "gap-3" : "gap-5"}`}>
      {groups.map((group) => (
        <div key={group.label}>
          {rail ? (
            <span className="mx-auto mb-1.5 block h-px w-5 bg-line" aria-hidden />
          ) : (
            <p className="mb-1 px-3 text-[0.5625rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
              {group.label}
            </p>
          )}
          <div className={`flex flex-col ${rail ? "items-center gap-1" : "gap-px"}`}>
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  title={rail ? label : undefined}
                  aria-label={rail ? label : undefined}
                  className={`group relative flex items-center transition-colors ${
                    rail
                      ? "h-9 w-9 justify-center rounded-xl"
                      : "gap-2.5 rounded-xl py-2 pl-3 pr-3 text-[0.8125rem]"
                  } ${
                    active
                      ? "bg-white text-ink shadow-[0_1px_2px_rgba(21,32,46,0.06),0_6px_16px_-10px_rgba(21,32,46,0.25)]"
                      : "text-ink-2 hover:bg-ink/[0.045] hover:text-ink"
                  }`}
                >
                  {/* The teal rule marking where you are. It is the only thing
                      on the screen that moves between pages. */}
                  {!rail && (
                    <span
                      className={`nav-mark absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent ${
                        active ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  )}
                  <Icon
                    size={rail ? 17 : 16}
                    strokeWidth={1.75}
                    className={active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}
                  />
                  {!rail && label}
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
  const rail = useRail();

  return (
    <>
      {/* Desktop */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col gap-6 border-r border-ink/[0.07] bg-plane/60 py-5 backdrop-blur-2xl transition-[width] duration-300 lg:flex ${
          rail ? "w-[68px] px-2" : "w-[236px]"
        }`}
      >
        <div className={`flex items-center ${rail ? "justify-center" : "justify-between pl-3 pr-2"}`}>
          <Link href="/" aria-label="AIployee Command Centre">
            {rail ? <BrandMark size={30} /> : <BrandLockup />}
          </Link>
          {!rail && (
            <button
              onClick={toggleRail}
              className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink"
              aria-label="Collapse the navigation"
              title="Collapse the navigation"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
        <div className={`flex-1 overflow-y-auto ${rail ? "px-0" : "px-2"}`}>
          <NavLinks guest={guest} rail={rail} />
        </div>
        {rail ? (
          <button
            onClick={toggleRail}
            className="mx-auto rounded-lg p-2 text-ink-3 transition-colors hover:bg-ink/[0.05] hover:text-ink"
            aria-label="Expand the navigation"
            title="Expand the navigation"
          >
            <PanelLeftOpen size={16} />
          </button>
        ) : (
          guest && (
            <p className="px-5 text-[0.6875rem] leading-relaxed text-ink-3">
              Demo session. Sign in to reach the rest.
            </p>
          )
        )}
      </aside>

      {/* Mobile */}
      <button
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-3.5 z-40 rounded-xl border border-ink/10 bg-panel/70 p-2 text-ink-2 backdrop-blur-xl lg:hidden"
      >
        <Menu size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="page-in absolute inset-y-0 left-0 flex w-[264px] flex-col gap-6 border-r border-ink/[0.09] bg-plane/85 py-5 backdrop-blur-2xl">
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
