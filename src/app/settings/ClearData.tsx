"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

type Scope = "operational" | "everything";
type Counts = Record<string, number>;

const SCOPES: { value: Scope; title: string; keeps: string }[] = [
  {
    value: "operational",
    title: "Clear the book",
    keeps:
      "Keeps your organization, users, API keys, agents and integration settings — the voice platform webhook keeps working.",
  },
  {
    value: "everything",
    title: "Clear everything",
    keeps:
      "Also removes agents, API keys and integration settings. You will need to re-run setup and re-issue the voice platform key.",
  },
];

export function ClearData({ organizationName }: { organizationName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("operational");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"preview" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ total: number } | null>(null);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/settings/clear-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message ?? json.error ?? "Request failed");
    return json;
  }

  async function loadPreview(next: Scope) {
    setScope(next);
    setBusy("preview");
    setError(null);
    try {
      const json = await post({ scope: next, preview: true });
      setCounts(json.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not count the data");
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    try {
      const json = await post({ scope, confirm });
      setDone({ total: json.total });
      setCounts(null);
      setConfirm("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the data");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <p className="text-[0.78125rem] text-ink-2">
        Cleared {done.total} record{done.total === 1 ? "" : "s"}. The platform is empty and ready
        for a fresh import.
      </p>
    );
  }

  if (!open) {
    return (
      <div>
        <p className="mb-3 text-[0.78125rem] leading-relaxed text-ink-2">
          Remove the demo dataset or a finished book so you can start clean. Nothing here can be
          undone, so it asks you to type the organization name first.
        </p>
        <button
          className="btn btn-danger"
          onClick={() => {
            setOpen(true);
            void loadPreview("operational");
          }}
        >
          <Trash2 size={13} /> Clear data…
        </button>
      </div>
    );
  }

  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : 0;
  const active = SCOPES.find((s) => s.value === scope)!;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            onClick={() => loadPreview(s.value)}
            disabled={busy !== null}
            className={`btn text-[0.71875rem] ${scope === s.value ? "btn-primary" : ""}`}
          >
            {s.title}
          </button>
        ))}
      </div>

      <p className="text-[0.71875rem] leading-relaxed text-ink-3">{active.keeps}</p>

      {busy === "preview" && <p className="text-[0.78125rem] text-ink-2">Counting…</p>}

      {counts && (
        <div className="rounded-lg border border-line bg-white/[0.02] p-3">
          {total === 0 ? (
            <p className="text-[0.78125rem] text-ink-2">Nothing to clear — already empty.</p>
          ) : (
            <>
              <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">
                This will permanently delete:
              </p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[0.71875rem] sm:grid-cols-3">
                {Object.entries(counts)
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <li key={key} className="flex justify-between gap-2">
                      <span className="text-ink-3">{key}</span>
                      <span className="num font-medium text-ink">{n}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </div>
      )}

      {total > 0 && (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-[rgba(208,59,59,0.35)] bg-[rgba(208,59,59,0.08)] p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#ec8181]" />
            <p className="text-[0.75rem] text-ink-2">
              This cannot be undone. Type <span className="font-semibold text-ink">{organizationName}</span>{" "}
              to confirm.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="field min-w-[240px]"
              value={confirm}
              placeholder={organizationName}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button
              className="btn btn-danger"
              disabled={busy !== null || confirm.trim() !== organizationName}
              onClick={clear}
            >
              <Trash2 size={13} />
              {busy === "clear" ? "Clearing…" : `Clear ${total} record${total === 1 ? "" : "s"}`}
            </button>
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => {
                setOpen(false);
                setCounts(null);
                setConfirm("");
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {error && <p className="text-[0.78125rem] text-[#ec8181]">{error}</p>}
    </div>
  );
}
