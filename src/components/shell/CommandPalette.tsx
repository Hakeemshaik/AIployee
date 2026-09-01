"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Bot,
  CalendarClock,
  FileText,
  LayoutDashboard,
  PhoneCall,
  Radar,
  ScanSearch,
  Search,
  Settings,
  Sparkles,
  Upload,
  User,
  Users,
} from "lucide-react";

type Result = {
  kind: "debtor" | "campaign" | "agent" | "page";
  href: string;
  title: string;
  subtitle: string;
};

const PAGES: Result[] = [
  { kind: "page", href: "/", title: "Dashboard", subtitle: "Go to page" },
  { kind: "page", href: "/debtors", title: "Debtors", subtitle: "Go to page" },
  { kind: "page", href: "/debtors/import", title: "Import debtors", subtitle: "Action" },
  { kind: "page", href: "/campaigns", title: "Campaigns", subtitle: "Go to page" },
  { kind: "page", href: "/campaigns/new", title: "New campaign", subtitle: "Action" },
  { kind: "page", href: "/calls", title: "Calls", subtitle: "Go to page" },
  { kind: "page", href: "/analytics", title: "Call analytics", subtitle: "Go to page" },
  { kind: "page", href: "/promises", title: "Promises to pay", subtitle: "Go to page" },
  { kind: "page", href: "/payments", title: "Payments", subtitle: "Go to page" },
  { kind: "page", href: "/insights", title: "AI insights", subtitle: "Go to page" },
  { kind: "page", href: "/reports", title: "Reports", subtitle: "Go to page" },
  { kind: "page", href: "/agents", title: "Agents", subtitle: "Go to page" },
  { kind: "page", href: "/escalations", title: "Escalations", subtitle: "Go to page" },
  { kind: "page", href: "/settings", title: "Settings", subtitle: "Go to page" },
];

const PAGE_ICONS: Record<string, typeof Users> = {
  "/": LayoutDashboard,
  "/debtors": Users,
  "/debtors/import": Upload,
  "/campaigns": Radar,
  "/campaigns/new": Radar,
  "/calls": PhoneCall,
  "/analytics": ScanSearch,
  "/promises": CalendarClock,
  "/payments": Banknote,
  "/insights": Sparkles,
  "/reports": FileText,
  "/agents": Bot,
  "/escalations": AlertTriangle,
  "/settings": Settings,
};

const KIND_ICONS = { debtor: User, campaign: Radar, agent: Bot } as const;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const islandRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPalette = useCallback(() => {
    setQuery("");
    setRemote([]);
    setActive(0);
    setLoading(false);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette]);

  // A click anywhere else shrinks the island back to the button.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!islandRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function onQueryChange(value: string) {
    setQuery(value);
    setActive(0);
    if (debounce.current) clearTimeout(debounce.current);
    if (value.trim().length < 2) {
      setRemote([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`);
        const body = await res.json();
        setRemote(body.results ?? []);
      } catch {
        setRemote([]);
      } finally {
        setActive(0);
        setLoading(false);
      }
    }, 220);
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = q
      ? PAGES.filter((p) => p.title.toLowerCase().includes(q))
      : PAGES.slice(0, 6);
    return [...remote, ...pages].slice(0, 12);
  }, [query, remote]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      go(results[active].href);
    }
  }

  return (
    // -----------------------------------------------------------------------
    // The island.
    //
    // Collapsed, search is a round button of glass — just the magnifier, the
    // same silhouette as everything else in the bar. Pressed (or ⌘K), the
    // capsule itself stretches into the input, and the results hang off it in
    // a floating panel: the control grows into the thing you asked for instead
    // of summoning a dialog somewhere else on the screen. Escape, or a click
    // anywhere else, shrinks it back to the button.
    //
    // The width is animated on the container, so the stretch is the capsule
    // deforming — not a second element fading in over the first.
    // -----------------------------------------------------------------------
    <div ref={islandRef} className="relative">
      <div
        className={`flex items-center overflow-hidden rounded-full border bg-gradient-to-b from-white/90 to-white/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_1px_2px_rgba(21,32,46,0.05)] backdrop-blur-xl transition-all duration-300 ${
          open
            ? "w-[19rem] border-accent/35 sm:w-[23rem]"
            : "w-9 border-ink/[0.08] hover:border-accent/35"
        }`}
        style={{ transitionTimingFunction: "var(--ease-spring)" }}
      >
        <button
          onClick={() => (open ? setOpen(false) : openPalette())}
          className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-3 transition-colors hover:text-accent"
          aria-label={open ? "Close search" : "Open search"}
          aria-expanded={open}
        >
          <Search size={15} />
        </button>
        {/* The input exists only while the island is stretched, so a stray Tab
            can never land in an invisible field. */}
        {open && (
          <>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search, or jump to a page…"
              className="min-w-0 flex-1 bg-transparent py-2 pr-2 text-[0.8125rem] text-ink outline-none placeholder:text-ink-3"
              aria-label="Search"
            />
            {loading && (
              <span className="pulse-live mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            )}
            {!loading && (
              <kbd
                suppressHydrationWarning
                className="num mr-2 shrink-0 rounded-full border border-ink/[0.07] bg-ink/[0.045] px-2 py-1 text-[0.625rem] leading-none text-ink-3"
              >
                esc
              </kbd>
            )}
          </>
        )}
      </div>

      {open && (
        <div
          className="card-float menu-in absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[19rem] overflow-hidden p-0 sm:w-[23rem]"
          style={{ ["--origin" as string]: "top right" }}
        >
          <ul className="max-h-[46vh] overflow-y-auto overscroll-contain p-1.5">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-[0.8125rem] text-ink-3">
                {query.trim().length >= 2 ? "No matches." : "Type to search across the platform."}
              </li>
            ) : (
              results.map((r, i) => {
                const Icon = r.kind === "page" ? (PAGE_ICONS[r.href] ?? FileText) : KIND_ICONS[r.kind];
                return (
                  <li key={`${r.kind}-${r.href}`}>
                    <button
                      onClick={() => go(r.href)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-left transition-colors ${
                        i === active ? "bg-accent-soft" : ""
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-ink/[0.04]">
                        <Icon size={13} className={i === active ? "text-accent" : "text-ink-3"} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[0.8125rem] font-medium text-ink">{r.title}</span>
                        <span className="block truncate text-[0.6875rem] text-ink-3">{r.subtitle}</span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
