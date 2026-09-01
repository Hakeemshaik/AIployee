"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Overlay } from "@/components/Overlay";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the icon sits, so the detached capsule opens FROM it rather than
  // appearing somewhere else on the screen.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const openPalette = useCallback(() => {
    const box = triggerRef.current?.getBoundingClientRect();
    // Grown a hair beyond the icon on every side, so the capsule reads as the
    // icon having lifted out of the bar, not as a strip pasted over it.
    setAnchor(box ? { top: box.top - 5, right: window.innerWidth - box.right - 5 } : { top: 72, right: 24 });
    setQuery("");
    setRemote([]);
    setActive(0);
    setLoading(false);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  // The anchor is a snapshot; if the window changes shape it is wrong, and
  // re-measuring mid-animation looks worse than starting again.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

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
    // -------------------------------------------------------------------------
    // The island, in the bar.
    //
    // Closed, search is one more item in the dock — the magnifier sitting in
    // line after the five words. Pressed (or ⌘K), it detaches: a capsule of its
    // own glass lifts out of the bar at the icon's exact position and stretches
    // leftward into the input, results hanging beneath it. Escape, or a click
    // anywhere else, puts it back.
    //
    // The open capsule is portalled to <body> and placed off the icon's
    // measured position, because the dock sits inside a horizontally scrolling
    // wrapper whose overflow clips anything that hangs below it — the same trap
    // that once ate the More menu.
    // -------------------------------------------------------------------------
    <>
      <button
        ref={triggerRef}
        onClick={openPalette}
        className={`dock-item dock-icon transition-opacity duration-200 ${open ? "opacity-0" : ""}`}
        aria-label="Search"
        aria-expanded={open}
        title="Search (Ctrl K)"
      >
        <Search size={16} strokeWidth={1.9} className="text-ink-3" />
      </button>

      {open && anchor && (
        <Overlay>
          <div
            ref={islandRef}
            className="fixed z-[60]"
            style={{ top: anchor.top, right: anchor.right }}
          >
            <div className="island-in flex w-[min(23rem,calc(100vw-2rem))] items-center overflow-hidden rounded-full border border-accent/35 bg-gradient-to-b from-white/95 to-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_14px_34px_-18px_rgba(21,32,46,0.45)] backdrop-blur-2xl">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center text-accent">
                <Search size={16} />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search, or jump to a page…"
                className="min-w-0 flex-1 bg-transparent py-2.5 pr-2 text-[0.8125rem] text-ink outline-none placeholder:text-ink-3"
                aria-label="Search"
              />
              {loading ? (
                <span className="pulse-live mr-3.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              ) : (
                <kbd className="num mr-2.5 shrink-0 rounded-full border border-ink/[0.07] bg-ink/[0.045] px-2 py-1 text-[0.625rem] leading-none text-ink-3">
                  esc
                </kbd>
              )}
            </div>

            <div
              className="card-float menu-in absolute right-0 top-[calc(100%+0.5rem)] w-[min(23rem,calc(100vw-2rem))] overflow-hidden p-0"
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
          </div>
        </Overlay>
      )}
    </>
  );
}
