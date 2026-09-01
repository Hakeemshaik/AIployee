"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Loader2, X } from "lucide-react";
import { METHODS_NEEDING_BANK, PAYMENT_METHODS, SA_BANKS, label } from "@/lib/domain";
import { formatDayMonth, money } from "@/lib/format";
import { Overlay } from "@/components/Overlay";
import { Select } from "@/components/Select";

// ---------------------------------------------------------------------------
// Writing down what somebody promised.
//
// A collector on a call has about four seconds to capture this before the
// conversation moves on, so the form is built around the answers people
// actually give rather than around the database columns.
//
// Nobody says "sixteen thousand one hundred and fifty rand". They say "the
// full amount", "half now", "a thousand". Nobody says "the third of October".
// They say "month end", "next Friday", "payday". So those are buttons, and the
// exact fields underneath are for the answers the buttons do not cover — they
// update as you press, so you can always see the real number and the real date
// before saving.
//
// Everything the buttons fill in is still editable. A shortcut that cannot be
// corrected is a trap.
// ---------------------------------------------------------------------------

function iso(date: Date): string {
  // Local date, not UTC: toISOString() in UTC+2 turns a promise made at 01:00
  // on the 5th into the 4th.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** The coming Friday. Today, if today is Friday. */
function nextFriday(): Date {
  const date = new Date();
  date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
  return date;
}

/** The last day of this month, or of next month if this one is nearly done. */
function monthEnd(): Date {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return end;
}

/**
 * The 25th — the day most South African salaries land, which is when most of
 * these promises are actually kept. Next month's if this month's has gone.
 */
function payday(): Date {
  const now = new Date();
  if (now.getDate() < 25) return new Date(now.getFullYear(), now.getMonth(), 25);
  return new Date(now.getFullYear(), now.getMonth() + 1, 25);
}

type Chip = { label: string; hint?: string; value: string };

export function PromiseButton({
  debtor,
  outstanding,
  hasOpenPromise,
  buttonClass = "btn",
}: {
  debtor: { id: string; name: string };
  /** What the account owes, so "the full amount" is one press. */
  outstanding: number;
  /** One live promise at a time — the server enforces it, this explains it. */
  hasOpenPromise: boolean;
  buttonClass?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("eft");
  const [bank, setBank] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const amountChips: Chip[] = useMemo(() => {
    if (outstanding <= 0) return [];
    const half = Math.round(outstanding / 2);
    return [
      { label: "Full amount", hint: money(outstanding), value: String(Math.round(outstanding)) },
      { label: "Half", hint: money(half), value: String(half) },
    ];
  }, [outstanding]);

  const dateChips: Chip[] = useMemo(
    () => [
      { label: "Today", value: iso(new Date()) },
      { label: "Tomorrow", value: iso(addDays(1)) },
      { label: "Friday", value: iso(nextFriday()) },
      { label: "Payday", hint: "the 25th", value: iso(payday()) },
      { label: "Month end", value: iso(monthEnd()) },
    ],
    [],
  );

  const needsBank = METHODS_NEEDING_BANK.includes(method);
  const amountValue = Number(amount);
  const ready = amountValue > 0 && date !== "" && !busy;

  function reset() {
    setAmount("");
    setDate("");
    setMethod("eft");
    setBank("");
    setNote("");
    setError(null);
    setDone(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/promises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debtorId: debtor.id,
          amount: amountValue,
          promisedDate: date,
          method,
          bank: needsBank && bank ? bank : undefined,
          note: note.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" && body.error !== "validation_failed"
            ? body.error
            : "Check the amount and the date.",
        );
      }
      setDone(true);
      router.refresh();
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The promise could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-[0.75rem] transition-all ${
      active
        ? "border-accent/50 bg-accent/12 font-medium text-ink"
        : "border-line bg-white/60 text-ink-2 hover:border-accent/40 hover:bg-white hover:text-ink"
    }`;

  return (
    <>
      <button
        className={buttonClass}
        onClick={() => setOpen(true)}
        title={
          hasOpenPromise
            ? "This account already has an open promise"
            : "Write down what they promised to pay"
        }
      >
        <CalendarClock size={14} /> Promise to pay
      </button>

      {open && (
        <Overlay>
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
            <div
              className="scrim-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]"
              onClick={() => !busy && setOpen(false)}
            />
            <div className="card-float pop-in relative flex max-h-[86dvh] w-full max-w-md flex-col overflow-y-auto p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[0.9375rem] font-semibold text-ink">Promise to pay</h2>
                  <p className="mt-0.5 truncate text-[0.75rem] text-ink-3">
                    {debtor.name} · {money(outstanding)} outstanding
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-full p-1.5 text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>

              {done ? (
                <p className="flex items-center justify-center gap-2 py-8 text-center text-[0.875rem] text-good">
                  <Check size={16} /> Promise recorded — the account stops being dialled.
                </p>
              ) : (
                <div className="space-y-4">
                  {hasOpenPromise && (
                    <p className="rounded-xl border border-warning/35 bg-warning/[0.08] px-3 py-2 text-[0.75rem] leading-relaxed text-ink-2">
                      This account already has an open promise. Cancel that one first — two live
                      commitments on one account make every follow-up figure wrong.
                    </p>
                  )}

                  {/* --- how much --- */}
                  <div>
                    <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">How much?</p>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {amountChips.map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => setAmount(c.value)}
                          className={chip(amount === c.value)}
                        >
                          {c.label}
                          {c.hint && <span className="num ml-1.5 text-ink-3">{c.hint}</span>}
                        </button>
                      ))}
                    </div>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[0.8125rem] text-ink-3">
                        R
                      </span>
                      <input
                        type="number"
                        min={1}
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        aria-label="Amount promised"
                        className="field num w-full pl-9"
                      />
                    </div>
                  </div>

                  {/* --- when --- */}
                  <div>
                    <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">By when?</p>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {dateChips.map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => setDate(c.value)}
                          className={chip(date === c.value)}
                          title={new Date(c.value).toLocaleDateString("en-ZA", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="date"
                      value={date}
                      min={iso(new Date())}
                      onChange={(e) => setDate(e.target.value)}
                      aria-label="Date promised"
                      className="field w-full"
                    />
                  </div>

                  {/* --- how --- */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">How?</p>
                      <Select
                        value={method}
                        onChange={setMethod}
                        aria-label="Payment method"
                        className="w-full"
                        options={PAYMENT_METHODS.map((m) => ({ value: m, label: label(m) }))}
                      />
                    </div>
                    {needsBank && (
                      <div>
                        <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">Which bank?</p>
                        <Select
                          value={bank}
                          onChange={setBank}
                          aria-label="Bank"
                          placeholder="Not said"
                          className="w-full"
                          options={[
                            { value: "", label: "Not said" },
                            ...SA_BANKS.map((b) => ({ value: b, label: b })),
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">
                      Anything they said <span className="font-normal text-ink-3">(optional)</span>
                    </p>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Paying after the medical aid refund clears"
                      aria-label="Note"
                      className="field w-full"
                    />
                  </div>

                  {error && <p className="text-[0.78125rem] leading-relaxed text-critical">{error}</p>}

                  <button
                    onClick={save}
                    disabled={!ready}
                    className="btn btn-primary w-full justify-center"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                    {busy
                      ? "Saving…"
                      : amountValue > 0 && date
                        ? `Promise ${money(amountValue)} by ${formatDayMonth(date)}`
                        : "Promise to pay"}
                  </button>
                  <p className="text-[0.6875rem] leading-relaxed text-ink-3">
                    While a promise is open the account is not dialled. It becomes broken on its
                    own three days after the date if nothing is paid.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}
