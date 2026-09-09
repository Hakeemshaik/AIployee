"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESCALATION_STATUSES, label } from "@/lib/domain";
import { useConfirm } from "@/components/Dialog";
import { Select } from "@/components/Select";

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
  const confirm = useConfirm();

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
      <Select
        className="py-1 text-[0.71875rem]"
        value={assignedToUserId ?? ""}
        disabled={busy || status === "resolved"}
        aria-label="Assign collector"
        onChange={(value) => update({ assignedToUserId: value || null })}
        options={[
          { value: "", label: "Unassigned" },
          ...users.map((u) => ({ value: u.id, label: u.name })),
        ]}
      />
      <Select
        className="py-1 text-[0.71875rem]"
        value={status}
        disabled={busy}
        aria-label="Status"
        onChange={(next) => {
          if (next !== "resolved") {
            update({ status: next });
            return;
          }
          void (async () => {
            const ok = await confirm({
              title: "Mark this escalation as resolved?",
              body: "It leaves the queue and stops counting as outstanding. You can reopen it afterwards if it turns out not to be settled.",
              confirmLabel: "Mark resolved",
            });
            if (ok) update({ status: next });
            else router.refresh();
          })();
        }}
        options={ESCALATION_STATUSES.map((s) => ({ value: s, label: label(s) }))}
      />
    </div>
  );
}
