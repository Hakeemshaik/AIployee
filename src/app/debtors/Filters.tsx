"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { DEBTOR_STATUSES, label } from "@/lib/domain";

export function DebtorFilters({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if ((params.get("q") ?? "") !== search) setParam("q", search);
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const select = "field min-w-[130px]";
  return (
    <div className="card-2 mb-4 flex flex-wrap items-center gap-2 p-3">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, account or phone…"
          className="field w-[220px] pl-8"
          aria-label="Search debtors"
        />
      </div>
      <select className={select} value={params.get("status") ?? ""} onChange={(e) => setParam("status", e.target.value)} aria-label="Status">
        <option value="">All statuses</option>
        {DEBTOR_STATUSES.map((s) => (
          <option key={s} value={s}>{label(s)}</option>
        ))}
      </select>
      <select className={select} value={params.get("campaign") ?? ""} onChange={(e) => setParam("campaign", e.target.value)} aria-label="Campaign">
        <option value="">All campaigns</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select className={select} value={params.get("risk") ?? ""} onChange={(e) => setParam("risk", e.target.value)} aria-label="Risk">
        <option value="">All risk</option>
        <option value="low">Low risk</option>
        <option value="medium">Medium risk</option>
        <option value="high">High risk</option>
      </select>
      <select className={select} value={params.get("amount") ?? ""} onChange={(e) => setParam("amount", e.target.value)} aria-label="Amount">
        <option value="">Any amount</option>
        <option value="0-2500">Under R2,500</option>
        <option value="2500-10000">R2,500 – R10,000</option>
        <option value="10000-50000">R10,000 – R50,000</option>
        <option value="50000-">Over R50,000</option>
      </select>
      <select className={select} value={params.get("overdue") ?? ""} onChange={(e) => setParam("overdue", e.target.value)} aria-label="Days overdue">
        <option value="">Any age</option>
        <option value="0-30">0–30 days</option>
        <option value="31-60">31–60 days</option>
        <option value="61-90">61–90 days</option>
        <option value="91-">90+ days</option>
      </select>
      <select className={select} value={params.get("contact") ?? ""} onChange={(e) => setParam("contact", e.target.value)} aria-label="Last contact">
        <option value="">Any last contact</option>
        <option value="7">Contacted in 7 days</option>
        <option value="14">Contacted in 14 days</option>
        <option value="30">Contacted in 30 days</option>
      </select>
      <select className={select} value={params.get("promise") ?? ""} onChange={(e) => setParam("promise", e.target.value)} aria-label="Promise status">
        <option value="">Any promise state</option>
        <option value="has_open">Has open promise</option>
        <option value="overdue">Promise overdue</option>
        <option value="none">No promise</option>
      </select>
      {params.size > 0 && (
        <button
          className="btn btn-ghost text-[0.75rem]"
          onClick={() => {
            setSearch("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
