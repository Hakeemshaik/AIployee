"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Pause, Play } from "lucide-react";

const TRANSITIONS: Record<string, { to: string; label: string; icon: "play" | "pause" | "done"; confirm?: string }[]> = {
  draft: [{ to: "scheduled", label: "Schedule", icon: "play" }, { to: "active", label: "Activate", icon: "play" }],
  scheduled: [{ to: "active", label: "Activate now", icon: "play" }],
  active: [
    { to: "paused", label: "Pause", icon: "pause" },
    { to: "completed", label: "Complete", icon: "done", confirm: "Complete this campaign? Dialling stops and it moves to reporting." },
  ],
  paused: [
    { to: "active", label: "Resume", icon: "play" },
    { to: "completed", label: "Complete", icon: "done", confirm: "Complete this campaign? Dialling stops and it moves to reporting." },
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
