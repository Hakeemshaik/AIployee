"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Loader2, PhoneOutgoing, X } from "lucide-react";
import { ESCALATION_PRIORITIES, ESCALATION_REASONS, label } from "@/lib/domain";
import { RecordPaymentButton } from "@/app/payments/RecordPayment";
import { CallResult } from "@/components/CallResult";
import { useConfirm } from "@/components/Dialog";
import { Select } from "@/components/Select";
import { Overlay } from "@/components/Overlay";

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
  const [callNote, setCallNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const confirm = useConfirm();

  /**
   * Call this one account, now.
   *
   * One customer written with the configured flag, which is what the flow's
   * Insert Customer event fires on — the same mechanism as a form submit, and
   * the same guardrails as a campaign send: calling hours, the deny list, and
   * every status that is never dialled are all checked on the server.
   */
  async function callNow() {
    const ok = await confirm({
      title: `Call ${debtor.name} now?`,
      body: (
        <>
          Account <span className="font-medium text-ink">{debtor.accountNumber}</span> is written to
          the voice platform and the flow dials it as it lands. This rings a real phone.
        </>
      ),
      confirmLabel: "Place the call",
      kind: "call",
    });
    if (!ok) return;
    setBusy(true);
    setCallNote(null);
    setAttemptId(null);
    try {
      const res = await fetch("/api/calling/one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debtorId: debtor.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "The call could not be placed.");
      // The panel takes it from here: ringing, answered, and what came of it.
      setAttemptId(body.attemptId as string);
    } catch (err) {
      setCallNote({
        ok: false,
        text: err instanceof Error ? err.message : "The call could not be placed.",
      });
    } finally {
      setBusy(false);
    }
  }

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
      <Select
        value={currentCampaignId ?? ""}
        disabled={busy}
        onChange={assignCampaign}
        aria-label="Assign campaign"
        options={[
          { value: "", label: "No campaign" },
          ...campaigns.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <button className="btn" onClick={callNow} disabled={busy} title="Write this account and let the flow dial it">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <PhoneOutgoing size={13} />} Call now
      </button>
      <RecordPaymentButton fixedDebtor={debtor} buttonClass="btn" />
      <button className="btn btn-danger" onClick={() => setEscalateOpen(true)}>
        <AlertTriangle size={13} /> Escalate
      </button>
      {assignError && <span className="text-[0.6875rem] text-critical">{assignError}</span>}
      {attemptId && (
        <div className="w-full">
          <CallResult attemptId={attemptId} />
        </div>
      )}
      {callNote && (
        <p
          className={`w-full rounded-lg border px-3 py-2 text-[0.75rem] leading-relaxed ${
            callNote.ok ? "border-good/35 bg-good/8 text-ink" : "border-serious/35 bg-serious/8 text-ink"
          }`}
        >
          {callNote.text}
        </p>
      )}

      {escalateOpen && (
        <Overlay>
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]">
          <div className="scrim-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]" onClick={() => !busy && setEscalateOpen(false)} />
          <div className="card-float pop-in relative flex max-h-[86dvh] w-full max-w-md flex-col overflow-y-auto p-5">
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
                  <Select
                    id="esc-reason"
                    name="reason"
                    className="w-full"
                    defaultValue="ai_unable_to_resolve"
                    options={ESCALATION_REASONS.map((r) => ({ value: r, label: label(r) }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="esc-priority">Priority</label>
                  <Select
                    id="esc-priority"
                    name="priority"
                    className="w-full"
                    defaultValue="medium"
                    options={ESCALATION_PRIORITIES.map((p) => ({ value: p, label: label(p) }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="esc-notes">Notes for the collector</label>
                <textarea id="esc-notes" name="notes" rows={3} className="field w-full resize-y" placeholder="Context for the assigned collector" />
              </div>
              {error && <p className="text-[0.78125rem] text-critical">{error}</p>}
              <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center">
                {busy ? "Escalating…" : "Create escalation"}
              </button>
              <p className="text-[0.6875rem] leading-relaxed text-ink-3">
                The debtor is marked as escalated and AI dialling stops until the case is resolved.
              </p>
            </form>
          </div>
        </div>
        </Overlay>
      )}
    </div>
  );
}
