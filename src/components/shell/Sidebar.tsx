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
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/debtors", label: "Debtors", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Radar },
  { href: "/calls", label: "Calls", icon: PhoneCall },
  { href: "/promises", label: "Promises to Pay", icon: CalendarClock },
  { href: "/payments", label: "Payments", icon: Banknote },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/escalations", label: "Escalations", icon: AlertTriangle },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.8125rem] transition-colors ${
              active
                ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1px_rgba(57,135,229,0.25)]"
                : "text-ink-2 hover:bg-white/[0.05] hover:text-ink"
            }`}
          >
            <Icon
              size={16}
              strokeWidth={1.8}
              className={active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-b from-[#3f8de9] to-[#2d6fc4] text-[13px] font-bold text-white shadow-[0_0_18px_rgba(57,135,229,0.35)]">
        A
      </span>
      <span className="leading-tight">
        <span className="block text-[0.9375rem] font-semibold tracking-tight text-ink">AIployee</span>
        <span className="block text-[0.5625rem] font-medium uppercase tracking-[0.14em] text-ink-3">
          Command Centre
        </span>
      </span>
    </Link>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-6 border-r border-line bg-plane/70 py-5 backdrop-blur-xl lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto px-2">
          <NavLinks />
        </div>
        <p className="px-5 text-[0.6875rem] leading-relaxed text-ink-3">
          AI voice collections,
          <br />
          analysed end-to-end.
        </p>
      </aside>

      {/* Mobile top bar trigger */}
      <button
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-3.5 z-40 rounded-lg border border-line bg-panel/90 p-2 text-ink-2 backdrop-blur lg:hidden"
      >
        <Menu size={18} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[268px] flex-col gap-6 border-r border-line bg-plane py-5">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-ink-3 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
