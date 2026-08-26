"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Compliance = {
  callingHoursStart: string;
  callingHoursEnd: string;
  callingDays: string;
  maxAttemptsPerDebtor: number;
  maxAttemptsPerDay: number;
  retryIntervalHours: number;
  recordingConsentRequired: boolean;
  recordingDisclosure: string;
  escalateOnDispute: boolean;
  escalateOnHardship: boolean;
  escalateOnVulnerable: boolean;
  maxAIArrangementAmount: number;
  honourOptOut: boolean;
  freezeContactOnDispute: boolean;
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

function Toggle({
  checked,
  onChange,
  label: text,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line-2 bg-white/[0.02] p-3">
      <span>
        <span className="block text-[0.8125rem] font-medium text-ink">{text}</span>
        <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-ink-3">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-[#3987e5]"
      />
    </label>
  );
}

export function ComplianceForm({ initial }: { initial: Compliance }) {
  const router = useRouter();
  const [form, setForm] = useState<Compliance>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  function set<K extends keyof Compliance>(key: K, value: Compliance[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  const days = form.callingDays.split(",").filter(Boolean);
  function toggleDay(day: string) {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    set("callingDays", DAYS.filter((d) => next.includes(d)).join(","));
  }

  async function save() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/settings/compliance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(true);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const labelCls = "mb-1 block text-[0.71875rem] font-medium text-ink-2";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Calling hours — from</label>
          <input type="time" className="field w-full" value={form.callingHoursStart} onChange={(e) => set("callingHoursStart", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Calling hours — to</label>
          <input type="time" className="field w-full" value={form.callingHoursEnd} onChange={(e) => set("callingHoursEnd", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Calling days</label>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`rounded-md border px-2 py-1 text-[0.6875rem] transition-colors ${
                  days.includes(d)
                    ? "border-[rgba(57,135,229,0.4)] bg-accent-soft text-ink"
                    : "border-line bg-white/[0.03] text-ink-3 hover:text-ink-2"
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Max attempts per debtor</label>
          <input type="number" min={1} max={50} className="field w-full" value={form.maxAttemptsPerDebtor} onChange={(e) => set("maxAttemptsPerDebtor", Number(e.target.value))} />
        </div>
        <div>
          <label className={labelCls}>Max attempts per day</label>
          <input type="number" min={1} max={10} className="field w-full" value={form.maxAttemptsPerDay} onChange={(e) => set("maxAttemptsPerDay", Number(e.target.value))} />
        </div>
        <div>
          <label className={labelCls}>Retry interval (hours)</label>
          <input type="number" min={1} max={720} className="field w-full" value={form.retryIntervalHours} onChange={(e) => set("retryIntervalHours", Number(e.target.value))} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Recording disclosure message</label>
          <input className="field w-full" value={form.recordingDisclosure} onChange={(e) => set("recordingDisclosure", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Max AI arrangement amount (R)</label>
          <input type="number" min={0} className="field w-full" value={form.maxAIArrangementAmount} onChange={(e) => set("maxAIArrangementAmount", Number(e.target.value))} />
          <p className="mt-1 text-[0.65625rem] text-ink-3">Arrangements above this are escalated to a human.</p>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Toggle checked={form.recordingConsentRequired} onChange={(v) => set("recordingConsentRequired", v)} label="Recording consent required" hint="The agent must disclose recording at the start of every call." />
        <Toggle checked={form.honourOptOut} onChange={(v) => set("honourOptOut", v)} label="Honour opt-outs" hint="A debtor who opts out is suppressed from all AI dialling." />
        <Toggle checked={form.escalateOnDispute} onChange={(v) => set("escalateOnDispute", v)} label="Escalate disputes" hint="Disputed accounts route straight to a human collector." />
        <Toggle checked={form.freezeContactOnDispute} onChange={(v) => set("freezeContactOnDispute", v)} label="Freeze contact on dispute" hint="No further AI contact while a dispute is open." />
        <Toggle checked={form.escalateOnHardship} onChange={(v) => set("escalateOnHardship", v)} label="Escalate financial hardship" hint="Hardship signals route to an affordability review." />
        <Toggle checked={form.escalateOnVulnerable} onChange={(v) => set("escalateOnVulnerable", v)} label="Escalate vulnerable customers" hint="Vulnerability signals always require a human." />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn btn-primary">
          {busy ? "Saving…" : "Save guardrails"}
        </button>
        {saved && <span className="text-[0.75rem] text-[#5fc46a]">Changes saved</span>}
        {error && <span className="text-[0.75rem] text-[#ec8181]">Changes could not be saved.</span>}
      </div>
      <p className="text-[0.6875rem] leading-relaxed text-ink-3">
        These guardrails are configuration, not legal advice — set them to match your organization&apos;s
        regulatory obligations and mandates. They are enforced against campaigns and passed to the
        voice platform as dialling constraints.
      </p>
    </div>
  );
}
