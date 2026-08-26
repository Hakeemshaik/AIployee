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
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

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
    <>
      <button
        onClick={openPalette}
        className="hidden items-center gap-2 rounded-lg border border-line bg-white/[0.04] px-2.5 py-1.5 text-[0.75rem] text-ink-3 transition-colors hover:bg-white/[0.07] hover:text-ink-2 sm:inline-flex"
        aria-label="Open search"
      >
        <Search size={13} />
        Search…
        <kbd suppressHydrationWarning className="rounded border border-line bg-black/30 px-1.5 py-0.5 text-[0.625rem] text-ink-3">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <button
        onClick={openPalette}
        className="rounded-lg border border-line bg-white/[0.04] p-2 text-ink-3 sm:hidden"
        aria-label="Open search"
      >
        <Search size={15} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass-solid relative w-full max-w-lg overflow-hidden p-0">
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={15} className="shrink-0 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search debtors, campaigns, agents… or jump to a page"
                className="w-full bg-transparent py-3.5 text-[0.875rem] text-ink outline-none placeholder:text-ink-3"
                aria-label="Search"
              />
              {loading && <span className="text-[0.6875rem] text-ink-3">Searching…</span>}
            </div>
            <ul className="max-h-[46vh] overflow-y-auto p-1.5">
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
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          i === active ? "bg-accent-soft" : ""
                        }`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white/[0.04]">
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
        </div>
      )}
    </>
  );
}
