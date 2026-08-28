import { resolveJobixEnv, JobixClient, JobixError } from "@/services/jobix/client";

// ---------------------------------------------------------------------------
// What the running server can actually see, and whether it works.
//
// "It is set in the hosting dashboard" and "the running function received it"
// are different facts, and the gap between them has cost this project more
// time than any bug. So this reports three states per variable, never two:
//
//   missing — the variable is not present at all
//   empty   — present but blank, which is what a paste that lost its value
//             looks like, and what a variable saved for the wrong environment
//             looks like from here
//   set     — present with a value (never the value itself)
//
// The flow's own ids are NOT listed here. They are saved in the database and
// shown on the Dialling flow card, and listing them in both places meant one
// card reading "Not set" while the other showed them saved.
//
// A deployment only sees the variables that existed WHEN IT WAS BUILT. Adding
// one and not redeploying leaves the old deployment blind to it, which reads
// exactly like the variable having disappeared.
// ---------------------------------------------------------------------------

export type VarState = "set" | "empty" | "missing";

export type VarStatus = {
  name: string;
  state: VarState;
  required: boolean;
  purpose: string;
};

export type ConnectionStatus = {
  environment: string | null;
  branch: string | null;
  commit: string | null;
  vars: VarStatus[];
  /** True when a sign-in could be attempted at all. */
  canTest: boolean;
  summary: string;
};

function stateOf(name: string): VarState {
  const value = process.env[name];
  if (value === undefined) return "missing";
  return value.trim() === "" ? "empty" : "set";
}

const VARIABLES: { name: string; required: boolean; purpose: string }[] = [
  { name: "JOBIX_EMAIL", required: true, purpose: "The dashboard sign-in. Reading calls needs it." },
  { name: "JOBIX_PASSWORD", required: true, purpose: "The dashboard sign-in." },
  { name: "JOBIX_CALLING_ENABLED", required: false, purpose: "Must be true before the platform may dial." },
  { name: "CRON_SECRET", required: false, purpose: "Enables unattended imports and scheduled starts." },
  { name: "AUTH_SECRET", required: false, purpose: "Signs session cookies. Without it sessions reset when the store is cleared." },
];

export function connectionStatus(): ConnectionStatus {
  const vars = VARIABLES.map((v) => ({ ...v, state: stateOf(v.name) }));
  const email = vars.find((v) => v.name === "JOBIX_EMAIL")!;
  const password = vars.find((v) => v.name === "JOBIX_PASSWORD")!;
  const canTest = email.state === "set" && password.state === "set";

  const summary = canTest
    ? "A sign-in is configured. Use Test connection to confirm the credentials work."
    : [email, password].some((v) => v.state === "empty")
      ? "The sign-in variables are present but blank on this deployment. A blank value is what a failed paste, or a variable saved for a different environment, looks like from here."
      : "The sign-in variables are not on this deployment. Sign in below instead, which needs no redeploy — or add them and redeploy, since a deployment only sees the variables that existed when it was built.";

  return {
    environment: process.env.VERCEL_ENV ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    vars,
    canTest,
    summary,
  };
}

export type ConnectionTest = {
  ok: boolean;
  message: string;
  /** Agent names the workspace returned, so the right workspace is verifiable. */
  agents: string[];
};

/**
 * Actually sign in and read something back.
 *
 * A presence check cannot tell a correct password from a stale one. This does
 * the smallest real request there is and reports exactly what came back.
 */
export async function testConnection(): Promise<ConnectionTest> {
  const env = await resolveJobixEnv();
  if (!env || !env.email || !env.password) {
    return {
      ok: false,
      message:
        "No sign-in on this deployment. Sign in to Jobix below — or set JOBIX_EMAIL and JOBIX_PASSWORD and redeploy.",
      agents: [],
    };
  }
  try {
    const { requireWorkspace } = await import("@/services/jobix/api");
    const health = await requireWorkspace(new JobixClient(env), []);
    return {
      ok: true,
      message: health.message,
      agents: health.agentNames,
    };
  } catch (err) {
    if (err instanceof JobixError) {
      return { ok: false, message: err.message, agents: [] };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : "The connection test failed.",
      agents: [],
    };
  }
}
