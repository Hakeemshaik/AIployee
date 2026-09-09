import { db } from "@/lib/db";
import { loadFlowConfig } from "@/services/flow-config";
import { loadJobixEnv } from "@/services/jobix/client";
import { count } from "@/lib/format";

// ---------------------------------------------------------------------------
// What is set up, and what is next.
//
// Every step here is read from the running deployment and the database, never
// assumed: "connected" means credentials the server can actually see, "book
// imported" means rows, "calls arriving" means stored call records. The point
// is that somebody opening this platform for the first time can tell what is
// left without reading a conversation or a commit log.
//
// A step is never reported done on the strength of a variable being set in a
// dashboard somewhere — that gap is what made earlier debugging take a day.
// ---------------------------------------------------------------------------

export type SetupStep = {
  key: string;
  title: string;
  /** What this step gives you, in one line. */
  purpose: string;
  done: boolean;
  /** Current state in the operator's words — a count, a name, or what is missing. */
  detail: string;
  /** Where to go to do it. */
  href: string;
  hrefLabel: string;
  /** True when the step needs an environment variable, which only an admin can set. */
  serverSide?: boolean;
};

export type SetupStatus = {
  steps: SetupStep[];
  done: number;
  total: number;
};

export async function setupStatus(organizationId: string): Promise<SetupStatus> {
  const env = loadJobixEnv();
  const signInConfigured = !!(env?.email && env?.password);

  const [debtors, campaigns, conversations, transcripts, lastRun] = await Promise.all([
    db.debtor.count({ where: { organizationId } }),
    db.campaign.count({ where: { organizationId } }),
    db.jobixConversation.count({ where: { organizationId } }),
    db.jobixTranscript.count({ where: { organizationId } }),
    db.ingestionRun.findFirst({
      where: { organizationId },
      orderBy: { startedAt: "desc" },
      select: { status: true, finishedAt: true, conversationsFound: true },
    }),
  ]);

  const callingEnabled = process.env.JOBIX_CALLING_ENABLED === "true";
  const triggerConfigured = (await loadFlowConfig(organizationId)).triggerReady;
  const scheduleConfigured = !!process.env.CRON_SECRET;

  const steps: SetupStep[] = [
    {
      key: "connect",
      title: "Connect the voice platform",
      purpose: "Lets the platform read calls, transcripts and accounts from Jobix.",
      done: signInConfigured,
      detail: signInConfigured
        ? "A sign-in is configured on the server."
        : env
          ? "Only a static API token is set. The dashboard API rejects it — JOBIX_EMAIL and JOBIX_PASSWORD are needed."
          : "No credentials on the server. Set JOBIX_EMAIL and JOBIX_PASSWORD.",
      href: "/analytics",
      hrefLabel: "Call analytics",
      serverSide: true,
    },
    {
      key: "import",
      title: "Import the calls",
      purpose: "Brings call records, transcripts and accounts onto the platform.",
      done: conversations > 0,
      detail:
        conversations > 0
          ? `${count(conversations)} calls stored, ${count(transcripts)} with a transcript${
              lastRun?.finishedAt ? "." : " (a run is in progress)."
            }`
          : lastRun
            ? `The last import ended as "${lastRun.status}" with nothing stored.`
            : "Nothing imported yet. Choose a date window and press Import.",
      href: "/analytics",
      hrefLabel: "Call analytics",
    },
    {
      key: "book",
      title: "Load the book",
      purpose: "The accounts to work: uploaded from a client file, or pulled from the voice platform.",
      done: debtors > 0,
      detail:
        debtors > 0
          ? `${count(debtors)} accounts on the platform.`
          : "No accounts yet. Upload the client's spreadsheet in any format.",
      href: "/debtors/import",
      hrefLabel: "Import accounts",
    },
    {
      key: "campaign",
      title: "Create a campaign",
      purpose: "Names a run, holds its accounts, and gives its calls somewhere to be counted.",
      done: campaigns > 0,
      detail:
        campaigns > 0
          ? `${campaigns} campaign${campaigns === 1 ? "" : "s"}. Open one to import accounts and send the dialling list.`
          : "No campaigns yet. Name one, then import accounts straight into it.",
      href: "/campaigns/new",
      hrefLabel: "New campaign",
    },
    {
      key: "calling",
      title: "Enable dialling from here",
      purpose: "Lets the platform trigger the flow, so a run can be started or scheduled.",
      done: callingEnabled && triggerConfigured,
      detail:
        callingEnabled && triggerConfigured
          ? "Dialling and the flow trigger are both configured."
          : !triggerConfigured
            ? "The flow trigger is not configured. Set the flow and its trigger node under Settings."
            : "The trigger is configured but dialling is off. Set JOBIX_CALLING_ENABLED=true once the flow's entry filter gates on the call field.",
      href: "/campaigns",
      hrefLabel: "Campaigns",
      serverSide: true,
    },
    {
      key: "unattended",
      title: "Run to a schedule (optional)",
      purpose: "Imports overnight and starts scheduled campaigns with nobody at the screen.",
      done: scheduleConfigured,
      detail: scheduleConfigured
        ? "A scheduler secret is set, so unattended imports and starts can run."
        : "Not set. Scheduling still works while a campaign page is open; set CRON_SECRET for unattended runs.",
      href: "/settings",
      hrefLabel: "Settings",
      serverSide: true,
    },
  ];

  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}
