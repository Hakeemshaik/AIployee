"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Pause, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Status bookkeeping — and ONLY bookkeeping.
//
// These buttons write the campaign's status column. They do not send a
// dialling list, and they do not make a single call. So the ones that used to
// sit here reading "Activate" and "Schedule" — the most prominent buttons on
// the page, in the primary colour — were the worst thing in the product: press
// Activate and the campaign shows as live, with nobody being dialled and
// nothing in the voice platform's customer list.
//
// Starting a run is step 2 of the page, which sends the list and triggers the
// flow, and scheduling one is the same panel. Neither belongs here. What is
// left is the one honest bookkeeping action: closing a campaign off so it
// moves to reporting.
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, { to: string; label: string; icon: "play" | "pause" | "done"; confirm?: string }[]> = {
  draft: [],
  scheduled: [],
  active: [
    {
      to: "completed",
      label: "Mark complete",
      icon: "done",
      confirm: "Complete this campaign? It moves to reporting, and the launch panel no longer offers to start it.",
    },
  ],
  paused: [
    {
      to: "completed",
      label: "Mark complete",
      icon: "done",
      confirm: "Complete this campaign? It moves to reporting, and the launch panel no longer offers to start it.",
    },
  ],
  completed: [],
};

const ICONS = { play: Play, pause: Pause, done: CheckCircle2 };

export function StatusControls({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function transition(to: string, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(to);
    setError(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  const options = TRANSITIONS[status] ?? [];
  if (!options.length) return null;
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[0.6875rem] text-[#ec8181]">The status could not be updated.</span>}
      {options.map((opt) => {
        const Icon = ICONS[opt.icon];
        return (
          <button
            key={opt.to}
            onClick={() => transition(opt.to, opt.confirm)}
            disabled={busy !== null}
            className={`btn ${opt.icon === "play" ? "btn-primary" : ""}`}
          >
            <Icon size={13} />
            {busy === opt.to ? "Saving…" : opt.label}
          </button>
        );
      })}
    </div>
  );
}
