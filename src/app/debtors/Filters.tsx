"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { DEBTOR_STATUSES, label } from "@/lib/domain";
import { Select } from "@/components/Select";

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
      <Select
        className={select}
        value={params.get("status") ?? ""}
        onChange={(value) => setParam("status", value)}
        aria-label="Status"
        options={[
          { value: "", label: "All statuses" },
          ...DEBTOR_STATUSES.map((s) => ({ value: s, label: label(s) })),
        ]}
      />
      <Select
        className={select}
        value={params.get("campaign") ?? ""}
        onChange={(value) => setParam("campaign", value)}
        aria-label="Campaign"
        options={[
          { value: "", label: "All campaigns" },
          ...campaigns.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <Select
        className={select}
        value={params.get("risk") ?? ""}
        onChange={(value) => setParam("risk", value)}
        aria-label="Risk"
        options={[
          { value: "", label: "All risk" },
          { value: "low", label: "Low risk" },
          { value: "medium", label: "Medium risk" },
          { value: "high", label: "High risk" },
        ]}
      />
      <Select
        className={select}
        value={params.get("amount") ?? ""}
        onChange={(value) => setParam("amount", value)}
        aria-label="Amount"
        options={[
          { value: "", label: "Any amount" },
          { value: "0-2500", label: "Under R2,500" },
          { value: "2500-10000", label: "R2,500 \u2013 R10,000" },
          { value: "10000-50000", label: "R10,000 \u2013 R50,000" },
          { value: "50000-", label: "Over R50,000" },
        ]}
      />
      <Select
        className={select}
        value={params.get("overdue") ?? ""}
        onChange={(value) => setParam("overdue", value)}
        aria-label="Days overdue"
        options={[
          { value: "", label: "Any age" },
          { value: "0-30", label: "0\u201330 days" },
          { value: "31-60", label: "31\u201360 days" },
          { value: "61-90", label: "61\u201390 days" },
          { value: "91-", label: "90+ days" },
        ]}
      />
      <Select
        className={select}
        value={params.get("contact") ?? ""}
        onChange={(value) => setParam("contact", value)}
        aria-label="Last contact"
        options={[
          { value: "", label: "Any last contact" },
          { value: "7", label: "Contacted in 7 days" },
          { value: "14", label: "Contacted in 14 days" },
          { value: "30", label: "Contacted in 30 days" },
        ]}
      />
      <Select
        className={select}
        value={params.get("promise") ?? ""}
        onChange={(value) => setParam("promise", value)}
        aria-label="Promise status"
        options={[
          { value: "", label: "Any promise state" },
          { value: "has_open", label: "Has open promise" },
          { value: "overdue", label: "Promise overdue" },
          { value: "none", label: "No promise" },
        ]}
      />
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
