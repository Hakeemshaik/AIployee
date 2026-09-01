"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  PhoneOutgoing,
  Save,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui";
import type { FlowConfig, FlowInspection, FlowSettingSource } from "@/services/flow-config";

// ---------------------------------------------------------------------------
// The dialling flow.
//
// Three settings decide whether a run can start: which flow, which node in it
// to trigger, and what value arms a record for the flow's entry filter. None
// is a secret, so none needs to be an environment variable — and holding them
// there meant a redeploy for every change.
//
// The flow address can be pasted straight from the browser. Reading the flow
// lists its nodes, which both confirms the right flow and finds the trigger
// node without a DevTools capture.
// ---------------------------------------------------------------------------

const SOURCE_NOTE: Record<FlowSettingSource, string> = {
  saved: "Saved here",
  environment: "From an environment variable",
  unset: "Not set",
};

function SourceTag({ source }: { source: FlowSettingSource }) {
  return (
    <span
      className={`text-[0.625rem] ${
        source === "saved" ? "text-good" : source === "environment" ? "text-ink-3" : "text-warning"
      }`}
    >
      {SOURCE_NOTE[source]}
    </span>
  );
}

export function FlowCard({ initial, canEdit }: { initial: FlowConfig; canEdit: boolean }) {
  const router = useRouter();
  const [config, setConfig] = useState(initial);
  const [flowInput, setFlowInput] = useState(initial.flowUuid ?? "");
  const [nodeInput, setNodeInput] = useState(initial.triggerNodeUuid ?? "");
  const [flagInput, setFlagInput] = useState(initial.callFlag ?? "");
  const [start, setStart] = useState<"insert" | "trigger">(initial.flowStart);
  const [inspection, setInspection] = useState<FlowInspection | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function post(body: unknown, kind: "read" | "save") {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "That did not work.");
      return payload;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function read() {
    const payload = (await post({ inspect: flowInput }, "read")) as FlowInspection | null;
    if (!payload) return;
    setInspection(payload);
    setFlowInput(payload.flowUuid);
    const suggested = payload.nodes.find((node) => node.suggested && node.uuid);
    if (suggested?.uuid && !nodeInput) setNodeInput(suggested.uuid);
  }

  async function save() {
    const payload = (await post(
      { flowUuid: flowInput, triggerNodeUuid: nodeInput, callFlag: flagInput, flowStart: start },
      "save",
    )) as FlowConfig | null;
    if (!payload) return;
    setConfig(payload);
    setSaved(true);
    router.refresh();
  }

  return (
    <Card
      title="Dialling flow"
      subtitle="Which flow the platform starts, and what arms an account for it"
      actions={
        canEdit ? (
          <button className="btn btn-primary" disabled={busy !== null} onClick={save}>
            {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>
        ) : undefined
      }
    >
      <p
        className={`mb-3 flex items-start gap-2 text-[0.78125rem] leading-relaxed ${
          start === "insert" || config.triggerReady ? "text-ink-2" : "text-warning"
        }`}
      >
        {start === "insert" || config.triggerReady ? (
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" />
        ) : (
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        )}
        {start === "insert"
          ? "This flow runs when a customer is written, so no trigger node is needed — sending a dialling list starts the calls."
          : config.triggerReady
            ? "The flow and its trigger node are set, so the platform can start a run itself."
            : "Without both the flow and its trigger node the platform prepares the list but cannot start the run — you press Run in Jobix instead."}
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.71875rem] text-ink-2">Flow address</span>
            <SourceTag source={config.flowUuidSource} />
          </span>
          <span className="flex gap-2">
            <input
              className="field num flex-1"
              placeholder="https://dashboard.jobix.ai/automation/…"
              value={flowInput}
              onChange={(event) => setFlowInput(event.target.value)}
              disabled={!canEdit}
            />
            <button className="btn" disabled={busy !== null || !flowInput.trim()} onClick={read}>
              {busy === "read" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              Read the flow
            </button>
          </span>
          <span className="mt-1 block text-[0.65625rem] text-ink-3">
            Paste the whole address from the browser — the id is taken out of it.
          </span>
        </label>

        {/* The setting that decides whether anything dials at all. A flow whose
            entry is an Insert Customer event runs when a customer is WRITTEN —
            arming one that already exists is an update, and an update raises no
            event, so writing for the wrong mode never rings a phone and never
            reports an error. */}
        <fieldset className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.71875rem] text-ink-2">The flow starts when…</span>
            <SourceTag source={config.flowStartSource} />
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "insert", label: "A customer is written" },
                { value: "trigger", label: "The trigger node is fired" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                onClick={() => setStart(option.value)}
                disabled={!canEdit}
                className={`rounded-full border px-2.5 py-1 text-[0.6875rem] transition-colors ${
                  start === option.value
                    ? "border-accent/45 bg-accent-soft text-ink"
                    : "border-line bg-white/[0.03] text-ink-2 hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[0.65625rem] leading-relaxed text-ink-3">
            {start === "insert"
              ? "Your flow's first node is an event holding Insert Customer. Sending a dialling list writes each account with the call flag already set, which fires the flow and places the call there and then — so sending IS starting, and it needs calling enabled and the hours to be open."
              : "The run begins when the platform fires the flow's Run node. Accounts are written unarmed, armed afterwards, and nobody is dialled until you press Start."}
          </span>
        </fieldset>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.71875rem] text-ink-2">Trigger node</span>
            <SourceTag source={config.triggerNodeUuidSource} />
          </span>
          <input
            className="field num w-full"
            placeholder="The event node at the start of the flow"
            value={nodeInput}
            onChange={(event) => setNodeInput(event.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.71875rem] text-ink-2">Call flag</span>
            <SourceTag source={config.callFlagSource} />
          </span>
          <input
            className="field num w-full"
            placeholder="READY"
            value={flagInput}
            onChange={(event) => setFlagInput(event.target.value)}
            disabled={!canEdit}
          />
          <span className="mt-1 block text-[0.65625rem] leading-relaxed text-ink-3">
            The value written to each account&apos;s <span className="num">call</span> column, and what the
            flow&apos;s entry filter must match. A fixed word means the filter is written once and never
            edited again. Leave it empty and each run&apos;s batch code goes there instead — which dials, but
            means editing the flow before every run.
          </span>
        </label>
      </div>

      {inspection && (
        <div className="mt-4 border-t border-line-2 pt-3">
          <p className="mb-2 text-[0.71875rem] leading-relaxed text-ink-2">{inspection.note}</p>
          {inspection.nodes.length > 0 && (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Kind</th>
                    <th className="text-right">Position</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inspection.nodes.map((node) => (
                    <tr key={node.companyNodeId}>
                      <td className="text-ink">
                        {node.name}
                        {node.suggested && (
                          <span className="ml-2 rounded-full border border-accent/45 bg-accent-soft px-1.5 py-0.5 text-[0.5625rem] text-ink">
                            likely the entry
                          </span>
                        )}
                      </td>
                      <td className="text-ink-3">{node.kind ?? "—"}</td>
                      <td className="num text-right text-ink-3">{node.number ?? "—"}</td>
                      <td className="text-right">
                        {node.uuid ? (
                          canEdit && (
                            <button
                              className="btn"
                              onClick={() => setNodeInput(node.uuid!)}
                              disabled={nodeInput === node.uuid}
                            >
                              {nodeInput === node.uuid ? <Check size={12} /> : <PhoneOutgoing size={12} />}
                              {nodeInput === node.uuid ? "Chosen" : "Use this one"}
                            </button>
                          )
                        ) : (
                          <span className="text-[0.625rem] text-ink-3">no id returned</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {saved && (
        <p className="mt-3 flex items-center gap-2 text-[0.78125rem] text-good">
          <Check size={13} className="shrink-0" />
          Saved. No redeploy needed — the next run uses these settings.
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-serious/35 bg-serious/8 px-3 py-2 text-[0.78125rem] text-serious">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="mt-3 text-[0.6875rem] text-ink-3">Only an admin can change these.</p>
      )}
    </Card>
  );
}
