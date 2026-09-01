"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, Merge } from "lucide-react";
import { count, formatDate, money } from "@/lib/format";
import { Card } from "@/components/ui";

// ---------------------------------------------------------------------------
// Duplicate accounts.
//
// The point of showing this is that duplicates are invisible damage: the book
// looks bigger than it is, every rate that divides by the book is diluted, and
// one copy carries the promise while the other looks ignored.
//
// A merge cannot be undone, so nothing happens without ticking groups and
// confirming, and each group shows exactly which record survives and what
// moves onto it.
// ---------------------------------------------------------------------------

type Member = {
  debtorId: string;
  name: string;
  accountNumber: string;
  phone: string;
  balance: number;
  accounts: number;
  calls: number;
  promises: number;
  payments: number;
  createdAt: string;
  campaignName: string | null;
  keeper: boolean;
};

type Group = {
  key: string;
  matchedOn: "provider_uuid" | "phone";
  members: Member[];
  doubleCountedValue: number;
};

export type DuplicateReport = {
  groups: Group[];
  extraRecords: number;
  overstatedValue: number;
  scanned: number;
};

type MergeResult = {
  groupsMerged: number;
  recordsRemoved: number;
  accountsMoved: number;
  callsMoved: number;
  promisesMoved: number;
  paymentsMoved: number;
};

const MATCH_LABEL: Record<Group["matchedOn"], string> = {
  provider_uuid: "Same customer on the voice platform",
  phone: "Same phone number",
};

export function DuplicatesCard({ initial, canMerge }: { initial: DuplicateReport; canMerge: boolean }) {
  const router = useRouter();
  const [report, setReport] = useState(initial);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function merge() {
    if (chosen.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/debtors/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupKeys: [...chosen], confirmed: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "The merge could not be completed.");
      setResult(body as MergeResult);
      setChosen(new Set());
      // Re-scan, so what is left on screen is what is left in the book.
      const rescan = await fetch("/api/debtors/duplicates", { cache: "no-store" });
      if (rescan.ok) setReport((await rescan.json()) as DuplicateReport);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The merge could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (report.groups.length === 0) {
    return (
      <Card title="Duplicate check" subtitle={`${count(report.scanned)} accounts checked`} className="mb-4">
        <p className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <CheckCircle2 size={14} className="shrink-0 text-good" />
          No duplicates. Every account has its own phone number and its own record on the voice platform.
        </p>
        {result && (
          <p className="mt-2 text-[0.71875rem] text-ink-3">
            Merged {count(result.groupsMerged)} group{result.groupsMerged === 1 ? "" : "s"} and removed{" "}
            {count(result.recordsRemoved)} duplicate record{result.recordsRemoved === 1 ? "" : "s"}.
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card
      title={`Duplicate accounts (${count(report.groups.length)})`}
      subtitle={`${count(report.extraRecords)} records too many · the book is overstated by ${money(report.overstatedValue)}`}
      className="mb-4"
      actions={
        canMerge ? (
          <div className="flex items-center gap-2">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setChosen(new Set(report.groups.map((g) => g.key)))}
            >
              Select all
            </button>
            <button className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={merge}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Merge size={13} />}
              Merge {chosen.size > 0 ? count(chosen.size) : ""}
            </button>
          </div>
        ) : undefined
      }
    >
      <p className="mb-3 text-[0.71875rem] leading-relaxed text-ink-2">
        Two records for the same person means the book counts their balance twice, every rate that divides by
        the book is diluted, and a promise recorded against one copy leaves the other looking ignored. Merging
        keeps one record and moves every account, call, promise and payment onto it — nothing is discarded, and
        it cannot be undone.
      </p>

      {result && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-good/35 bg-good/8 px-3 py-2.5 text-[0.78125rem] text-ink">
          <Check size={14} className="mt-0.5 shrink-0 text-good" />
          Merged {count(result.groupsMerged)} group{result.groupsMerged === 1 ? "" : "s"}: removed{" "}
          {count(result.recordsRemoved)} record{result.recordsRemoved === 1 ? "" : "s"} and moved{" "}
          {count(result.accountsMoved)} accounts, {count(result.callsMoved)} calls,{" "}
          {count(result.promisesMoved)} promises and {count(result.paymentsMoved)} payments.
        </p>
      )}

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-serious/35 bg-serious/8 px-3 py-2 text-[0.78125rem] text-serious">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="space-y-2.5">
        {report.groups.map((group) => (
          <div key={group.key} className="rounded-lg border border-line bg-white/[0.02] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2.5">
              {canMerge && (
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[#16b3a2]"
                  checked={chosen.has(group.key)}
                  onChange={() => toggle(group.key)}
                  aria-label={`Merge ${group.members[0]?.name}`}
                />
              )}
              <Copy size={12} className="shrink-0 text-ink-3" />
              <span className="text-[0.78125rem] font-medium text-ink">
                {count(group.members.length)} records
              </span>
              <span className="rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[0.625rem] text-ink-3">
                {MATCH_LABEL[group.matchedOn]}
              </span>
              {group.doubleCountedValue > 0 && (
                <span className="text-[0.6875rem] text-ink-3">
                  counted twice: {money(group.doubleCountedValue)}
                </span>
              )}
            </div>
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Account</th>
                    <th>Phone</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Promises</th>
                    <th>Added</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((member) => (
                    <tr key={member.debtorId} className={member.keeper ? undefined : "opacity-70"}>
                      <td className="text-ink">{member.name}</td>
                      <td className="num text-ink-3">{member.accountNumber}</td>
                      <td className="num text-ink-3">{member.phone}</td>
                      <td className="num text-right">{money(member.balance)}</td>
                      <td className="num text-right">{member.calls}</td>
                      <td className="num text-right">{member.promises}</td>
                      <td className="num text-ink-3">{formatDate(member.createdAt)}</td>
                      <td
                        className={`text-[0.6875rem] ${member.keeper ? "text-good" : "text-ink-3"}`}
                        title={
                          member.keeper
                            ? "This record survives; everything else moves onto it."
                            : "This record is removed after its history moves to the keeper."
                        }
                      >
                        {member.keeper ? "Kept" : "Merged away"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {!canMerge && (
        <p className="mt-3 text-[0.6875rem] text-ink-3">
          Only an admin can merge records.
        </p>
      )}
    </Card>
  );
}
