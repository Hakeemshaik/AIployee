"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, FileText, LogOut, Settings, Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// The account menu.
//
// It holds what is opened when something needs changing rather than when work
// needs doing — reports, agents, insights, settings — plus signing out. Those
// were behind a "More" button in the navigation row, where the menu was being
// clipped by the row's own horizontal scroll and never appeared. Here it hangs
// off the header, which clips nothing.
//
// Everything opened daily is a word in the row below. Nothing is in both
// places: a link that lives in two menus teaches people to trust neither.
// ---------------------------------------------------------------------------

const ITEMS = [
  { href: "/insights", label: "AI insights", icon: Sparkles },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AccountMenu({
  name,
  role,
  initials,
  guest = false,
}: {
  name: string;
  role: string;
  initials: string;
  guest?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Close on a click anywhere else, on Escape, and on arriving somewhere new —
  // a menu that only closes by clicking its own button is a menu people leave
  // open.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "signout" }),
      });
    } catch {
      // Even if the request failed, send them to /login — it re-checks the
      // session server-side and will bounce them back if they are still in.
    }
    router.push("/login");
    // Ending the session removes the shell from the root layout; without the
    // refresh the old layout stays on screen with stale navigation.
    router.refresh();
  }

  const items = guest ? [] : ITEMS;
  const hereAlready = items.some((item) => pathname.startsWith(item.href));

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account and settings"
        className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-2 transition-colors ${
          open || hereAlready
            ? "border-accent/40 bg-white"
            : "border-transparent hover:border-line hover:bg-white/60"
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.06] text-[0.6875rem] font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
          {initials || "—"}
        </span>
        <span className="hidden leading-tight md:block">
          <span className="block text-[0.8125rem] font-medium text-ink">{name}</span>
          <span className="block text-[0.6875rem] capitalize text-ink-3">{role}</span>
        </span>
        <ChevronDown
          size={14}
          className={`text-ink-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="card-float menu-in absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 p-1.5"
          style={{ ["--origin" as string]: "top right" }}
        >
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-[0.8125rem] transition-colors ${
                  active ? "bg-accent/10 text-ink" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
                }`}
              >
                <Icon
                  size={15}
                  strokeWidth={1.85}
                  className={active ? "text-accent" : "text-ink-3"}
                />
                {label}
              </Link>
            );
          })}
          {items.length > 0 && <span className="my-1.5 block h-px bg-line" aria-hidden />}
          <button
            role="menuitem"
            onClick={signOut}
            disabled={busy}
            className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-[0.8125rem] text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-60"
          >
            <LogOut size={15} strokeWidth={1.85} className="text-ink-3" />
            {busy ? "Signing out…" : guest ? "Leave demo" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
