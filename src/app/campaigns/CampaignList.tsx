"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { label } from "@/lib/domain";
import { count, money } from "@/lib/format";
import { Badge } from "@/components/ui";
import { DeleteCampaignButton } from "./DeleteCampaignButton";

// ---------------------------------------------------------------------------
// The campaign shelf.
//
// Campaigns stack: every month adds one or two, none get deleted (their history
// is why they exist), and within a year the live campaign is buried under the
// finished ones. So the shelf is ordered by what is happening — running first,
// then scheduled, then drafts, then the archive — and it can be searched and
// narrowed by state, so "the August arrears run" is typed, not scrolled to.
// ---------------------------------------------------------------------------

export type CampaignCard = {
  id: string;
  name: string;
  status: string;
  strategy: string;
  agentName: string | null;
  metrics: { totalDebtors: number; totalDebt: number; contacted: number };
};

/** Running things first; the archive last. Within a group, newest work first
 *  is the list order the server already sent. */
const STATUS_RANK: Record<string, number> = {
  active: 0,
  paused: 1,
  scheduled: 2,
  draft: 3,
  completed: 4,
};

const STATE_CHIPS = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "completed", label: "Finished" },
] as const;

function group(status: string): string {
  if (status === "active" || status === "paused") return "live";
  return status;
}

export function CampaignList({ campaigns, canDelete }: { campaigns: CampaignCard[]; canDelete: boolean }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<string>("all");

  const counts = useMemo(() => {
    const byState: Record<string, number> = { all: campaigns.length };
    for (const c of campaigns) byState[group(c.status)] = (byState[group(c.status)] ?? 0) + 1;
    return byState;
  }, [campaigns]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns
      .filter((c) => state === "all" || group(c.status) === state)
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.agentName ?? "").toLowerCase().includes(q) ||
          label(c.strategy).toLowerCase().includes(q),
      )
      .sort((x, y) => (STATUS_RANK[x.status] ?? 9) - (STATUS_RANK[y.status] ?? 9));
  }, [campaigns, search, state]);

  return (
    <>
      <div className="card-2 mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Campaign, agent or strategy…"
            className="field w-[230px] pl-8"
            aria-label="Search campaigns"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATE_CHIPS.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setState(chip.key)}
              className={`rounded-full border px-2.5 py-1 text-[0.6875rem] transition-colors ${
                state === chip.key
                  ? "border-accent/45 bg-accent-soft text-ink"
                  : "border-line bg-ink/[0.03] text-ink-2 hover:text-ink"
              }`}
            >
              {chip.label} <span className="num text-ink-3">{counts[chip.key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="card px-5 py-10 text-center text-[0.8125rem] text-ink-3">
          No campaign matches — clear the search or pick another state.
        </p>
      ) : (
        // Cards that identify a campaign and nothing more: enough to recognise
        // it and to see whether it has run. The measuring happens inside.
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c, i) => (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}`}
              className="card lift rise-in group relative block p-[1.125rem]"
              style={{ ["--i" as string]: Math.min(i, 8) }}
            >
              <div className="mb-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {/* Wraps rather than truncates: the name is how a campaign
                      is recognised, and half of it is not enough. */}
                  <p className="text-[0.9375rem] font-semibold leading-snug text-ink group-hover:text-accent-ink">
                    {c.name}
                  </p>
                  <p className="mt-0.5 truncate text-[0.71875rem] text-ink-3">
                    {label(c.strategy)}
                    {c.agentName ? ` · ${c.agentName}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge value={c.status} label={label(c.status)} />
                  {canDelete && (
                    <DeleteCampaignButton campaignId={c.id} name={c.name} accounts={c.metrics.totalDebtors} />
                  )}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line-2 pt-2.5">
                <span>
                  <span className="block text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Accounts
                  </span>
                  <span className="num text-[0.8125rem] font-medium text-ink">
                    {count(c.metrics.totalDebtors)}
                  </span>
                </span>
                <span>
                  <span className="block text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Book value
                  </span>
                  <span className="num text-[0.8125rem] font-medium text-ink">
                    {money(c.metrics.totalDebt)}
                  </span>
                </span>
                <span>
                  <span className="block text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Calls
                  </span>
                  <span className="num text-[0.8125rem] font-medium text-ink">
                    {c.metrics.contacted > 0 ? count(c.metrics.contacted) : "—"}
                  </span>
                </span>
              </div>

              <p className="mt-2.5 text-[0.6875rem] text-ink-3">
                {c.metrics.contacted > 0
                  ? "Open for calls, transcripts and analytics"
                  : "Not dialled yet — open to send the list"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
