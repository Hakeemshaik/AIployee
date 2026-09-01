"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Select } from "@/components/Select";
import { Overlay } from "@/components/Overlay";
import { label, PAYMENT_METHODS } from "@/lib/domain";
import { money } from "@/lib/format";

export function RecordPaymentButton({
  debtors = [],
  fixedDebtor,
  buttonClass = "btn btn-primary",
  outstanding,
}: {
  debtors?: { id: string; name: string; accountNumber: string }[];
  /** Lock the payment to one debtor (used on the debtor profile). */
  fixedDebtor?: { id: string; name: string; accountNumber: string };
  buttonClass?: string;
  /** What the account owes, when we know — makes "settled in full" one press. */
  outstanding?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [amount, setAmount] = useState("");

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
      setAmount("");
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
        <Overlay>
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <div className="scrim-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]" onClick={() => !busy && setOpen(false)} />
          <div className="card-float pop-in relative flex max-h-[86dvh] w-full max-w-md flex-col overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[0.9375rem] font-semibold text-ink">Record a payment</h2>
              <button className="btn-ghost btn p-1.5" onClick={() => setOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            {done ? (
              <p className="py-6 text-center text-[0.875rem] text-good">
                Payment recorded — balances and promises updated.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-3.5">
                {fixedDebtor ? (
                  <div>
                    <p className="mb-1 text-[0.71875rem] font-medium text-ink-2">Debtor</p>
                    <p className="field w-full bg-ink/[0.025] text-ink">
                      {fixedDebtor.name} — {fixedDebtor.accountNumber}
                    </p>
                    <input type="hidden" name="debtorId" value={fixedDebtor.id} />
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="debtorId">Debtor *</label>
                    <Select
                      id="debtorId"
                      name="debtorId"
                      required
                      className="w-full"
                      placeholder="Select a debtor\u2026"
                      options={debtors.map((d) => ({
                        value: d.id,
                        label: d.name,
                        hint: d.accountNumber,
                      }))}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="amount">Amount (R) *</label>
                    <input
                      id="amount"
                      name="amount"
                      type="number"
                      min={1}
                      step="0.01"
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="field num w-full"
                      placeholder="1500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="method">Method</label>
                    <Select
                      id="method"
                      name="method"
                      className="w-full"
                      defaultValue="eft"
                      options={PAYMENT_METHODS.map((m) => ({ value: m, label: label(m) }))}
                    />
                  </div>
                </div>
                {/* The commonest payment by far is the whole balance, and
                    typing it out from the page behind the dialog is where the
                    typos come from. */}
                {outstanding !== undefined && outstanding > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Settled in full", value: String(Math.round(outstanding)) },
                      { label: "Half", value: String(Math.round(outstanding / 2)) },
                    ].map((c) => (
                      <button
                        key={c.label}
                        type="button"
                        onClick={() => setAmount(c.value)}
                        className={`rounded-full border px-3 py-1.5 text-[0.75rem] transition-all ${
                          amount === c.value
                            ? "border-accent/50 bg-accent/12 font-medium text-ink"
                            : "border-line bg-white/60 text-ink-2 hover:border-accent/40 hover:bg-white hover:text-ink"
                        }`}
                      >
                        {c.label}
                        <span className="num ml-1.5 text-ink-3">{money(Number(c.value))}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="reference">Reference</label>
                  <input id="reference" name="reference" className="field w-full" placeholder="Bank / EFT reference" />
                </div>
                {error && <p className="text-[0.78125rem] text-critical">{error}</p>}
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
        </Overlay>
      )}
    </>
  );
}
