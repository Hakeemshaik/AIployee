"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { label, PAYMENT_METHODS } from "@/lib/domain";

export function RecordPaymentButton({
  debtors = [],
  fixedDebtor,
  buttonClass = "btn btn-primary",
}: {
  debtors?: { id: string; name: string; accountNumber: string }[];
  /** Lock the payment to one debtor (used on the debtor profile). */
  fixedDebtor?: { id: string; name: string; accountNumber: string };
  buttonClass?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries([...form.entries()].filter(([, v]) => v !== ""));
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error === "validation_failed" ? "Check the amount and debtor." : "The payment could not be recorded. Try again.");
      setDone(true);
      router.refresh();
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment could not be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className={buttonClass} onClick={() => setOpen(true)}>
        <Plus size={14} /> Record payment
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setOpen(false)} />
          <div className="glass-solid relative w-full max-w-md p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[0.9375rem] font-semibold text-ink">Record a payment</h2>
              <button className="btn-ghost btn p-1.5" onClick={() => setOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            {done ? (
              <p className="py-6 text-center text-[0.875rem] text-[#5fc46a]">
                Payment recorded — balances and promises updated.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-3.5">
                {fixedDebtor ? (
                  <div>
                    <p className="mb-1 text-[0.71875rem] font-medium text-ink-2">Debtor</p>
                    <p className="field w-full bg-white/[0.02] text-ink">
                      {fixedDebtor.name} — {fixedDebtor.accountNumber}
                    </p>
                    <input type="hidden" name="debtorId" value={fixedDebtor.id} />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="debtorId">Debtor *</label>
                    <select id="debtorId" name="debtorId" required className="field w-full" defaultValue="">
                      <option value="" disabled>Select a debtor…</option>
                      {debtors.map((d) => (
                        <option key={d.id} value={d.id}>{d.name} — {d.accountNumber}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="amount">Amount (R) *</label>
                    <input id="amount" name="amount" type="number" min={1} step="0.01" required className="field w-full" placeholder="1500" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="method">Method</label>
                    <select id="method" name="method" className="field w-full" defaultValue="eft">
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{label(m)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="reference">Reference</label>
                  <input id="reference" name="reference" className="field w-full" placeholder="Bank / EFT reference" />
                </div>
                {error && <p className="text-[0.78125rem] text-[#ec8181]">{error}</p>}
                <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center">
                  {busy ? "Recording…" : "Record payment"}
                </button>
                <p className="text-[0.6875rem] leading-relaxed text-ink-3">
                  The payment is applied to the debtor&apos;s open promise automatically and their
                  balance, status and campaign metrics update immediately.
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
