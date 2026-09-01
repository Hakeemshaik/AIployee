"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageSquareText, Search } from "lucide-react";
import { count, duration, formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui";
import { AccountDrawer } from "@/app/analytics/AccountDrawer";

// ---------------------------------------------------------------------------
// The calls that ran for one campaign.
//
// Two things an operator does with this list: skim it for who was reached, and
// open a call to read what was actually said. So reach is a filter, the search
// covers name, account and number, and any row opens the account's full
// history — every attempt, the transcript of each, and the reason behind each
// reach verdict.
// ---------------------------------------------------------------------------

export type CampaignCallRow = {
  conversationUuid: string;
  debtorId: string;
  name: string;
  phone: string;
  accountNumber: string;
  startedAt: string;
  durationSeconds: number;
  agentName: string | null;
  attempt: number;
  reached: boolean;
  reason: string;
  matchedBy: "contact_uuid" | "phone";
};

export type CampaignCallsPayload = {
  batchCode: string | null;
  batchSentAt: string | null;
  accountsInCampaign: number;
  accountsCarryingBatch: number;
  accountsDialled: number;
  totalCalls: number;
  reachedCalls: number;
  callsBeforeBatch: number;
  calls: CampaignCallRow[];
  truncated: number;
};

const MATCH_NOTES: Record<CampaignCallRow["matchedBy"], string> = {
  contact_uuid: "Matched on the voice platform's own customer identifier.",
  phone: "Matched on phone number — this call record carried no customer identifier.",
};

type Filter = "all" | "reached" | "not_reached";

export function CampaignCalls({
  log,
  bucketLabels,
  bucketExplanations,
}: {
  log: CampaignCallsPayload;
  bucketLabels: Record<string, string>;
  bucketExplanations: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openAccount, setOpenAccount] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return log.calls.filter((call) => {
      if (filter === "reached" && !call.reached) return false;
      if (filter === "not_reached" && call.reached) return false;
      if (!needle) return true;
      return (
        call.name.toLowerCase().includes(needle) ||
        call.accountNumber.toLowerCase().includes(needle) ||
        call.phone.replace(/\s/g, "").includes(needle.replace(/\s/g, ""))
      );
    });
  }, [log.calls, filter, search]);

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All calls", n: log.totalCalls },
    { key: "reached", label: "Reached", n: log.reachedCalls },
    { key: "not_reached", label: "Not reached", n: log.totalCalls - log.reachedCalls },
  ];

  return (
    <>
      <Card
        title={`Calls in this campaign (${count(log.totalCalls)})`}
        subtitle={
          log.batchCode
            ? `Batch ${log.batchCode}${log.batchSentAt ? ` · sent ${formatDateTime(log.batchSentAt)}` : ""}`
            : "No dialling batch has been sent for this campaign yet"
        }
        className="mb-4"
        pad={false}
      >
        <div className="space-y-3 border-b border-line-2 px-5 pb-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                className={`rounded-full border px-2.5 py-1 text-[0.6875rem] transition-colors ${
                  filter === chip.key
                    ? "border-accent/45 bg-accent-soft text-ink"
                    : "border-line bg-ink/[0.03] text-ink-2 hover:text-ink"
                }`}
              >
                {chip.label} <span className="num text-ink-3">{count(chip.n)}</span>
              </button>
            ))}
            <span className="ml-auto flex items-center gap-2">
              <span className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  className="field w-[230px] pl-8"
                  placeholder="Name, account or number…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search calls"
                />
              </span>
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-line bg-ink/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
              Accounts in campaign <span className="num">{count(log.accountsInCampaign)}</span>
            </span>
            <span className="rounded-full border border-line bg-ink/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
              Dialled <span className="num">{count(log.accountsDialled)}</span>
            </span>
            {log.batchCode && (
              <span className="rounded-full border border-line bg-ink/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                Carrying batch on the platform <span className="num">{count(log.accountsCarryingBatch)}</span>
              </span>
            )}
            {log.callsBeforeBatch > 0 && (
              <span className="rounded-full border border-line bg-ink/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-3">
                Excluded, predate the batch <span className="num">{count(log.callsBeforeBatch)}</span>
              </span>
            )}
          </div>

          <p className="text-[0.6875rem] leading-relaxed text-ink-3">
            Click any call to read the conversation. Reach is decided by reading the transcript, never from
            the platform&apos;s voicemail flag, and a call is tied to this campaign through the account it
            belongs to — by the voice platform&apos;s own customer identifier where the record carries one,
            otherwise by phone number.
            {log.batchSentAt
              ? " Calls before this batch was sent belong to an earlier run and are excluded."
              : " Without a sent batch every call to these accounts is listed, whenever it happened."}
          </p>
        </div>

        {log.calls.length === 0 ? (
          <p className="p-8 text-center text-[0.8125rem] text-ink-3">
            No calls recorded for these accounts yet. Import from Jobix on the Call analytics page after the
            batch has dialled.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-8 text-center text-[0.8125rem] text-ink-3">No calls match that filter.</p>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th className="text-right">Attempt</th>
                  <th className="text-right">Talk time</th>
                  <th>Agent</th>
                  <th>Outcome</th>
                  <th>Basis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((call) => (
                  <tr
                    key={call.conversationUuid}
                    className="cursor-pointer transition-colors hover:bg-ink/[0.03]"
                    onClick={() => setOpenAccount(call.debtorId)}
                    title="Open the account and read the conversation"
                  >
                    <td className="num text-ink-3">{formatDateTime(call.startedAt)}</td>
                    <td>
                      <Link
                        href={`/debtors/${call.debtorId}`}
                        className="font-medium text-ink hover:text-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {call.name}
                      </Link>
                      <span className="num ml-2 text-[0.6875rem] text-ink-3">{call.accountNumber}</span>
                    </td>
                    <td className="num text-right">{call.attempt}</td>
                    <td className="num text-right">{duration(call.durationSeconds)}</td>
                    <td className="text-ink-3">{call.agentName ?? "—"}</td>
                    <td>
                      <span className={call.reached ? "text-good" : "text-ink-3"} title={call.reason}>
                        {call.reached ? "Reached" : "Not reached"}
                      </span>
                    </td>
                    <td className="text-[0.6875rem] text-ink-3" title={MATCH_NOTES[call.matchedBy]}>
                      {call.matchedBy === "contact_uuid" ? "Identifier" : "Phone"}
                    </td>
                    <td className="text-right">
                      <MessageSquareText size={13} className="ml-auto text-ink-3" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(log.truncated > 0 || visible.length !== log.calls.length) && (
          <p className="border-t border-line-2 px-5 py-3 text-[0.6875rem] text-ink-3">
            Showing <span className="num">{count(visible.length)}</span> of{" "}
            <span className="num">{count(log.totalCalls)}</span> calls
            {log.truncated > 0 ? " — the list is capped at the 500 most recent" : ""}.
          </p>
        )}
      </Card>

      <AccountDrawer
        accountId={openAccount}
        onClose={() => setOpenAccount(null)}
        bucketLabels={bucketLabels}
        bucketExplanations={bucketExplanations}
      />
    </>
  );
}
