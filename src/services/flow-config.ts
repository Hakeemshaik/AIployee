import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// The dialling flow's settings.
//
// Three values decide whether the platform can start a run: which flow, which
// node inside it to trigger, and what value goes in the `call` column for the
// flow's entry filter to match.
//
// None of the three is a secret — every one of them is visible in the flow
// builder's own URL or its filter node — and holding them in environment
// variables meant a redeploy for every change, which is the single thing that
// has cost this project the most time. So they are stored per organization and
// editable in Settings, with environment variables kept as the fallback for a
// deployment configured the old way.
//
// Credentials stay in environment variables. This module never touches them.
// ---------------------------------------------------------------------------

/**
 * A refusal caused by what was typed, not by anything going wrong.
 *
 * Worth its own class so the API answers 400 rather than 500: a paste with no
 * flow id in it is the caller's to fix, and logging it as an internal error
 * buries the real ones.
 */
export class FlowConfigError extends Error {}

export type FlowSettingSource = "saved" | "environment" | "unset";

export type FlowConfig = {
  flowUuid: string | null;
  flowUuidSource: FlowSettingSource;
  triggerNodeUuid: string | null;
  triggerNodeUuidSource: FlowSettingSource;
  /**
   * The fixed value written to the `call` column. Null means no fixed flag is
   * configured, and the run's batch code is written instead — which works, but
   * forces the flow's filter to be edited before every run.
   */
  callFlag: string | null;
  callFlagSource: FlowSettingSource;
  /** Both ids present, so a run can actually be triggered. */
  triggerReady: boolean;
};

function resolve(saved: string | null | undefined, envName: string): [string | null, FlowSettingSource] {
  const savedValue = saved?.trim();
  if (savedValue) return [savedValue, "saved"];
  const envValue = process.env[envName]?.trim();
  if (envValue) return [envValue, "environment"];
  return [null, "unset"];
}

export async function loadFlowConfig(organizationId: string): Promise<FlowConfig> {
  const settings = await db.integrationSettings.findUnique({
    where: { organizationId },
    select: { flowUuid: true, triggerNodeUuid: true, callFlag: true },
  });

  const [flowUuid, flowUuidSource] = resolve(settings?.flowUuid, "JOBIX_FLOW_UUID");
  const [triggerNodeUuid, triggerNodeUuidSource] = resolve(
    settings?.triggerNodeUuid,
    "JOBIX_TRIGGER_NODE_UUID",
  );
  const [callFlag, callFlagSource] = resolve(settings?.callFlag, "JOBIX_CALL_FLAG");

  return {
    flowUuid,
    flowUuidSource,
    triggerNodeUuid,
    triggerNodeUuidSource,
    callFlag,
    callFlagSource,
    triggerReady: !!flowUuid && !!triggerNodeUuid,
  };
}

/**
 * What goes in the `call` column for one run.
 *
 * The fixed flag when there is one; otherwise the batch code, which still
 * dials but means the flow's filter has to name that code. Both the file
 * export and the in-app dialler go through here so the two can never write
 * different things — they did once, and the in-app path armed nothing because
 * the flow was filtering on the flag while the stamp carried a batch code.
 */
export function callColumnValue(config: FlowConfig, batchCode: string | undefined): string | undefined {
  return config.callFlag ?? batchCode;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Take the flow id out of whatever gets pasted.
 *
 * People paste the whole address bar, so accepting only a bare uuid is a
 * pointless obstacle: `https://dashboard.jobix.ai/automation/<uuid>` and the
 * uuid alone both work.
 */
export function parseFlowUuid(input: string): string | null {
  const match = input.match(UUID);
  return match ? match[0].toLowerCase() : null;
}

export type FlowConfigInput = {
  flowUuid?: string | null;
  triggerNodeUuid?: string | null;
  callFlag?: string | null;
};

/** Empty string clears a value back to the environment fallback. */
function normalise(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function saveFlowConfig(
  organizationId: string,
  userId: string,
  input: FlowConfigInput,
): Promise<FlowConfig> {
  const flowUuidRaw = normalise(input.flowUuid);
  // A pasted URL is fine; anything that is not a uuid is not.
  const flowUuid =
    flowUuidRaw === undefined || flowUuidRaw === null ? flowUuidRaw : parseFlowUuid(flowUuidRaw);
  if (flowUuidRaw && !flowUuid) {
    throw new FlowConfigError("That does not contain a flow id. Paste the flow's address from Jobix.");
  }

  const data = {
    ...(flowUuid !== undefined ? { flowUuid } : {}),
    ...(normalise(input.triggerNodeUuid) !== undefined
      ? { triggerNodeUuid: normalise(input.triggerNodeUuid) }
      : {}),
    ...(normalise(input.callFlag) !== undefined ? { callFlag: normalise(input.callFlag) } : {}),
  };

  await db.integrationSettings.upsert({
    where: { organizationId },
    create: { organizationId, provider: "jobix", ...data },
    update: data,
  });

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "integration.flow_settings_saved",
    entityType: "integration_settings",
    entityId: organizationId,
    // Ids, not credentials — safe to keep in the log, and the whole point of
    // the log is being able to see when dialling started pointing elsewhere.
    detail: data,
  });

  return loadFlowConfig(organizationId);
}

// --- reading the flow itself ------------------------------------------------

export type FlowNodeOption = {
  companyNodeId: number;
  name: string;
  number: number | null;
  uuid: string | null;
  kind: string | null;
  /** The node most likely to be the one the Run button triggers. */
  suggested: boolean;
};

export type FlowInspection = {
  flowUuid: string;
  nodes: FlowNodeOption[];
  /** True when the node list carried uuids, so a node can be picked here. */
  uuidsAvailable: boolean;
  note: string;
};

/**
 * List a flow's nodes so the trigger node can be chosen instead of captured.
 *
 * Finding this uuid used to mean opening DevTools, pressing Run and reading
 * the request body. The flow's own node list is already used for naming node
 * history, so if it carries uuids the whole detour disappears. If it does not,
 * that is said plainly rather than shown as an empty list.
 */
export async function inspectFlow(flowUuidInput: string): Promise<FlowInspection> {
  const flowUuid = parseFlowUuid(flowUuidInput);
  if (!flowUuid) {
    throw new FlowConfigError("That does not contain a flow id. Paste the flow's address from Jobix.");
  }

  const { JobixClient, resolveJobixEnv, JobixError } = await import("@/services/jobix/client");
  const env = await resolveJobixEnv();
  if (!env || !env.email || !env.password) {
    throw new JobixError(
      "No sign-in on this deployment, so the flow cannot be read. Set JOBIX_EMAIL and JOBIX_PASSWORD.",
      "not_configured",
    );
  }
  const { fetchFlowNodes } = await import("@/services/jobix/api");
  const nodes = await fetchFlowNodes(new JobixClient({ ...env, flowUuid }), flowUuid);

  const options: FlowNodeOption[] = nodes
    .map((node) => ({
      companyNodeId: node.companyNodeId,
      name: node.name ?? `Node ${node.number ?? node.companyNodeId}`,
      number: node.number,
      uuid: node.uuid,
      kind: node.kind,
      // The entry node is an event node, and in this flow it is the one holding
      // Insert Customer. Failing a kind, the lowest-numbered node is the entry.
      suggested: (node.kind ?? "").toLowerCase().includes("event") ||
        /insert customer|^event$/i.test(node.name ?? ""),
    }))
    .sort((a, b) => (a.number ?? a.companyNodeId) - (b.number ?? b.companyNodeId));

  if (options.length > 0 && !options.some((o) => o.suggested)) {
    options[0].suggested = true;
  }
  const uuidsAvailable = options.some((option) => !!option.uuid);

  return {
    flowUuid,
    nodes: options,
    uuidsAvailable,
    note: options.length === 0
      ? "This flow returned no nodes. Check the flow address, and that this sign-in belongs to the workspace that owns it."
      : uuidsAvailable
        ? "Pick the node the Run button fires — the event node at the start of the flow."
        : "This flow's node list carries no node ids, so the trigger node has to come from a capture of the builder's Run button. The names below at least confirm this is the right flow.",
  };
}
