"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { ESCALATION_PRIORITIES, ESCALATION_REASONS, label } from "@/lib/domain";
import { RecordPaymentButton } from "@/app/payments/RecordPayment";

export function DebtorActions({
  debtor,
  campaigns,
  currentCampaignId,
}: {
  debtor: { id: string; name: string; accountNumber: string };
  campaigns: { id: string; name: string }[];
  currentCampaignId: string | null;
}) {
  const router = useRouter();
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  async function assignCampaign(campaignId: string) {
    setBusy(true);
    setAssignError(null);
    try {
      const res = await fetch(`/api/debtors/${debtor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaignId || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setAssignError("The campaign assignment could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function escalate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debtorId: debtor.id,
          reason: form.get("reason"),
          priority: form.get("priority"),
          notes: form.get("notes") || undefined,
        }),
      });
      if (!res.ok) throw new Error("The escalation could not be created.");
      setEscalateOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The escalation could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="field"
        value={currentCampaignId ?? ""}
        disabled={busy}
        onChange={(e) => assignCampaign(e.target.value)}
        aria-label="Assign campaign"
        title="Assign this debtor to a campaign"
      >
        <option value="">No campaign</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <RecordPaymentButton fixedDebtor={debtor} buttonClass="btn" />
      <button className="btn btn-danger" onClick={() => setEscalateOpen(true)}>
        <AlertTriangle size={13} /> Escalate
      </button>
      {assignError && <span className="text-[0.6875rem] text-[#ec8181]">{assignError}</span>}

      {escalateOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setEscalateOpen(false)} />
          <div className="glass-solid relative w-full max-w-md p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[0.9375rem] font-semibold text-ink">Escalate {debtor.name}</h2>
              <button className="btn btn-ghost p-1.5" onClick={() => setEscalateOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={escalate} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="esc-reason">Reason</label>
                  <select id="esc-reason" name="reason" className="field w-full" defaultValue="ai_unable_to_resolve">
                    {ESCALATION_REASONS.map((r) => (
                      <option key={r} value={r}>{label(r)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="esc-priority">Priority</label>
                  <select id="esc-priority" name="priority" className="field w-full" defaultValue="medium">
                    {ESCALATION_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{label(p)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="esc-notes">Notes for the collector</label>
                <textarea id="esc-notes" name="notes" rows={3} className="field w-full resize-y" placeholder="Context for the assigned collector" />
              </div>
              {error && <p className="text-[0.78125rem] text-[#ec8181]">{error}</p>}
              <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center">
                {busy ? "Escalating…" : "Create escalation"}
              </button>
              <p className="text-[0.6875rem] leading-relaxed text-ink-3">
                The debtor is marked as escalated and AI dialling stops until the case is resolved.
              </p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
