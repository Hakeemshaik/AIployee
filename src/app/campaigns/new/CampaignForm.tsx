"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAMPAIGN_STRATEGIES, label } from "@/lib/domain";
import { Select } from "@/components/Select";

export function CampaignForm({ agents }: { agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(
      [...form.entries()].filter(([, v]) => v !== ""),
    );
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error === "validation_failed" ? "Please check the highlighted fields." : "The campaign could not be created. Try again.");
      router.push(`/campaigns/${body.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The campaign could not be created. Try again.");
      setBusy(false);
    }
  }

  const labelCls = "mb-1 block text-[0.71875rem] font-medium text-ink-2";
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="name">Campaign name *</label>
          <input id="name" name="name" required minLength={3} className="field w-full" placeholder="e.g. Retail Arrears — 60-90 Days" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="description">Description</label>
          <textarea id="description" name="description" rows={2} className="field w-full resize-y" placeholder="What this campaign covers and why" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="segment">Target debtor segment</label>
          <input id="segment" name="segment" className="field w-full" placeholder="e.g. Retail credit, R2,500–R15,000, 60–90 days overdue" />
        </div>
        <div>
          <label className={labelCls} htmlFor="agentId">AI agent</label>
          <Select
            id="agentId"
            name="agentId"
            className="w-full"
            defaultValue=""
            options={[
              { value: "", label: "Assign later" },
              ...agents.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="strategy">Collection strategy</label>
          <Select
            id="strategy"
            name="strategy"
            className="w-full"
            defaultValue="standard"
            options={CAMPAIGN_STRATEGIES.map((s) => ({ value: s, label: label(s) }))}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="startDate">Start date</label>
          <input id="startDate" name="startDate" type="date" className="field w-full" />
        </div>
        <div>
          <label className={labelCls} htmlFor="endDate">End date</label>
          <input id="endDate" name="endDate" type="date" className="field w-full" />
        </div>
        <div>
          <label className={labelCls} htmlFor="callingHoursStart">Calling hours — from</label>
          <input id="callingHoursStart" name="callingHoursStart" type="time" defaultValue="09:00" className="field w-full" />
        </div>
        <div>
          <label className={labelCls} htmlFor="callingHoursEnd">Calling hours — to</label>
          <input id="callingHoursEnd" name="callingHoursEnd" type="time" defaultValue="18:00" className="field w-full" />
        </div>
        <div>
          <label className={labelCls} htmlFor="maxAttempts">Maximum attempts per debtor</label>
          <input id="maxAttempts" name="maxAttempts" type="number" min={1} max={30} defaultValue={6} className="field w-full" />
        </div>
        <div>
          <label className={labelCls} htmlFor="retryIntervalHours">Retry interval (hours)</label>
          <input id="retryIntervalHours" name="retryIntervalHours" type="number" min={1} max={720} defaultValue={48} className="field w-full" />
        </div>
        <div>
          <label className={labelCls} htmlFor="status">Initial status</label>
          <Select
            id="status"
            name="status"
            className="w-full"
            defaultValue="draft"
            options={[
              { value: "draft", label: "Draft", hint: "Nothing runs until you launch it." },
              { value: "scheduled", label: "Scheduled", hint: "Set a start time on the campaign." },
              { value: "active", label: "Active", hint: "Bookkeeping only \u2014 no calls go out from here." },
            ]}
          />
        </div>
      </div>
      {error && <p className="text-[0.78125rem] text-critical">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Creating…" : "Create campaign"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => router.back()} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="text-[0.71875rem] leading-relaxed text-ink-3">
        Calling hours and attempt limits are also constrained by the organization-wide compliance
        settings — the stricter value applies.
      </p>
    </form>
  );
}
