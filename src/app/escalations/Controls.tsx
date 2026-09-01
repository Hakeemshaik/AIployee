"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESCALATION_STATUSES, label } from "@/lib/domain";

export function EscalationControls({
  escalationId,
  status,
  assignedToUserId,
  users,
}: {
  escalationId: string;
  status: string;
  assignedToUserId: string | null;
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/escalations/${escalationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError("The escalation could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {error && <span className="text-[0.6875rem] text-critical">{error}</span>}
      <select
        className="field py-1 text-[0.71875rem]"
        value={assignedToUserId ?? ""}
        disabled={busy || status === "resolved"}
        aria-label="Assign collector"
        onChange={(e) => update({ assignedToUserId: e.target.value || null })}
      >
        <option value="">Unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <select
        className="field py-1 text-[0.71875rem]"
        value={status}
        disabled={busy}
        aria-label="Status"
        onChange={(e) => {
          const next = e.target.value;
          if (next === "resolved" && !window.confirm("Mark this escalation as resolved?")) {
            router.refresh();
            return;
          }
          update({ status: next });
        }}
      >
        {ESCALATION_STATUSES.map((s) => (
          <option key={s} value={s}>{label(s)}</option>
        ))}
      </select>
    </div>
  );
}
