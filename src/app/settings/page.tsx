import { KeyRound, Webhook } from "lucide-react";
import { CreateKeyButton } from "./CreateKeyButton";
import { getContext, hasRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/services/settings";
import { setupStatus } from "@/services/setup-status";
import { connectionStatus } from "@/services/connection-status";
import { loadFlowConfig } from "@/services/flow-config";
import { companyKeyStatus, signInStatus } from "@/services/jobix/credentials";
import { SetupChecklist } from "@/components/SetupChecklist";
import { ConnectionCard } from "./ConnectionCard";
import { FlowCard } from "./FlowCard";
import { PlaceCallCard } from "./PlaceCallCard";
import { Badge, Card, Meta, PageHeader } from "@/components/ui";
import { ComplianceForm } from "./ComplianceForm";
import { ResetDataCard } from "./ResetDataCard";
import { TeamCard } from "./TeamCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const DIAL_OUTCOME_PAYLOAD = `POST /api/integrations/voice/dial-outcome
Authorization: Bearer <api key>
Content-Type: application/json

{
  "suid": "the reference sent as customer_data.main.suid",
  "status": "answered",          // or no_answer | voicemail | busy | failed
  "event_id": "jobix-call-123",  // the platform's own id, if it has one
  "started_at": "2026-09-01T09:15:02Z",
  "ended_at": "2026-09-01T09:17:41Z",
  "duration_seconds": 159,
  "recording_url": "https://recordings.example.com/call-123.mp3",
  "transcript": [
    { "role": "assistant", "text": "Good morning, is this Thabo?" },
    { "role": "user", "text": "Speaking." }
  ]
}`;

const EXAMPLE_PAYLOAD = `POST /api/integrations/voice/call-completed
Authorization: Bearer <api key>
Content-Type: application/json

{
  "externalCallId": "call_123",
  "accountNumber": "EDG-4127",
  "externalAgentId": "agent_naledi_01",
  "startedAt": "2026-08-24T10:15:00Z",
  "endedAt": "2026-08-24T10:19:05Z",
  "durationSeconds": 245,
  "status": "completed",
  "transcript": "...",
  "recordingUrl": "https://voice.example/rec/call_123.mp3",
  "outcome": "promise_to_pay"
}`;

export default async function SettingsPage() {
  const ctx = await getContext();
  const { compliance, apiKeys, users, org } = await getSettings(ctx.organizationId);
  const setup = await setupStatus(ctx.organizationId);
  const flow = await loadFlowConfig(ctx.organizationId);
  const jobixSignIn = await signInStatus();
  const jobixKey = await companyKeyStatus();
  const aiLive = process.env.AI_PROVIDER === "claude" && !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="page-in">
      <PageHeader
        title="Settings"
        description={`Guardrails, integrations and team for ${org.name}.`}
      />

      {/* The setup list is short and the integration cards are tall, so a
          two-column split left a column of nothing beside them. Setup runs
          across the top; the integration follows underneath it. */}
      <div className="mb-4 grid items-start gap-4">
        <SetupChecklist status={setup} />
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <ConnectionCard status={connectionStatus()} signIn={jobixSignIn} companyKey={jobixKey} />
          <div className="grid items-start gap-4">
            <FlowCard initial={flow} canEdit={hasRole(ctx, ["admin"])} />
            {hasRole(ctx, ["admin", "manager"]) && <PlaceCallCard />}
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card title="Organization">
          <dl>
            <Meta label="Name">{org.name}</Meta>
            <Meta label="Currency">{org.currency}</Meta>
            <Meta label="Timezone">{org.timezone}</Meta>
            <Meta label="Data isolation">Per-organization (multi-tenant)</Meta>
          </dl>
        </Card>
        <Card title="AI provider" subtitle="Analysis, insights and reporting engine">
          <dl>
            <Meta label="Active provider">
              <Badge value={aiLive ? "active" : "draft"} label={aiLive ? "Claude (Anthropic API)" : "Built-in engine"} />
            </Meta>
            <Meta label="Configuration">Server environment only</Meta>
          </dl>
          <p
            className="mt-3 text-[0.6875rem] leading-relaxed text-ink-3"
            title="Keys never reach the browser, and only aggregated, anonymised data is sent for insight generation."
          >
            Set <code className="text-ink-2">AI_PROVIDER=claude</code> and{" "}
            <code className="text-ink-2">ANTHROPIC_API_KEY</code> in the server environment.
          </p>
        </Card>
        {ctx.userRole === "admin" ? (
          <TeamCard selfId={ctx.userId} />
        ) : (
          <Card title="Team">
            <ul className="space-y-2.5">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[0.8125rem] font-medium text-ink">{u.name}</p>
                    <p className="text-[0.6875rem] text-ink-3">{u.email}</p>
                  </div>
                  <Badge value="neutral" label={u.role} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card
        className="mb-4"
        title="Compliance & guardrails"
        subtitle="Enforced on campaigns and the voice platform"
      >
        {compliance ? (
          <ComplianceForm
            initial={{
              callingHoursStart: compliance.callingHoursStart,
              callingHoursEnd: compliance.callingHoursEnd,
              callingDays: compliance.callingDays,
              maxAttemptsPerDebtor: compliance.maxAttemptsPerDebtor,
              maxAttemptsPerDay: compliance.maxAttemptsPerDay,
              retryIntervalHours: compliance.retryIntervalHours,
              recordingConsentRequired: compliance.recordingConsentRequired,
              recordingDisclosure: compliance.recordingDisclosure,
              escalateOnDispute: compliance.escalateOnDispute,
              escalateOnHardship: compliance.escalateOnHardship,
              escalateOnVulnerable: compliance.escalateOnVulnerable,
              maxAIArrangementAmount: compliance.maxAIArrangementAmount,
              honourOptOut: compliance.honourOptOut,
              freezeContactOnDispute: compliance.freezeContactOnDispute,
            }}
          />
        ) : (
          <p className="text-[0.8125rem] text-ink-3">No compliance settings have been configured for this organization.</p>
        )}
      </Card>

      {/* One card wide now that the event list has gone: in a two-column grid
          it sat beside an empty column. */}
      <div className="grid gap-4">
        {/* Named for what it is. Jobix results do NOT arrive here — they are
            pulled in by ingestion on the Call analytics page — and calling this
            "the voice platform integration" had a reader believing this was the
            live pipe. It is a working ingress for a provider that can post. */}
        <Card title="Call results, coming back" subtitle="Point the flow's call webhook here">
          {/* The one to wire up. A dial placed from here carries a reference,
              and this is where the platform hands it back with what happened. */}
          <div
            className="mb-3 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/[0.06] p-3"
            title="Send the suid back and the result finds its own account: the transcript is analysed, a promise to pay becomes a promise, an escalation becomes an escalation. A retry is safe — the same reference never makes a second call."
          >
            <Webhook size={15} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-[0.78125rem] font-medium text-ink">
                POST <span className="num">/api/integrations/voice/dial-outcome</span>
              </p>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-2">
                Keyed on the <code>suid</code> sent with the call. Bearer API key, scope{" "}
                <code>voice:ingest</code>.
              </p>
            </div>
          </div>
          {/* Needed to configure the webhook, but a reference payload sitting
              open is most of the page for everybody else. */}
          <details>
            <summary className="cursor-pointer text-[0.71875rem] text-ink-3">Show the payload</summary>
            <pre className="scroll-x mt-2 rounded-xl border border-line bg-ink/[0.05] p-3 text-[0.65625rem] leading-relaxed text-ink-2">
              {DIAL_OUTCOME_PAYLOAD}
            </pre>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-[0.71875rem] text-ink-3">
              The other endpoint
            </summary>
            <div className="page-in mt-2">
              <p className="mb-2 text-[0.6875rem] leading-relaxed text-ink-3">
                <span className="num">POST /api/integrations/voice/call-completed</span> matches by
                number or account reference. Same key, same scope.
              </p>
              <pre className="scroll-x rounded-xl border border-line bg-ink/[0.05] p-3 text-[0.65625rem] leading-relaxed text-ink-2">
                {EXAMPLE_PAYLOAD}
              </pre>
            </div>
          </details>
          <h3 className="mb-2 mt-4 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
            API keys
          </h3>
          <ul className="space-y-2">
            {apiKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-line-2 bg-ink/[0.025] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <KeyRound size={14} className="shrink-0 text-ink-3" />
                  <div className="min-w-0">
                    <p className="truncate text-[0.78125rem] font-medium text-ink">{k.name}</p>
                    <p className="num text-[0.6875rem] text-ink-3">
                      {k.keyPrefix}…&nbsp;·&nbsp;{k.scopes}&nbsp;·&nbsp;last used {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "never"}
                    </p>
                  </div>
                </div>
                <Badge value={k.revokedAt ? "cancelled" : "active"} label={k.revokedAt ? "Revoked" : "Active"} />
              </li>
            ))}
          </ul>
          <CreateKeyButton />
        </Card>
      </div>

      {/* Destructive, so it sits last and behind a typed confirmation. */}
      {ctx.userRole === "admin" && (
        <div className="mt-4">
          <ResetDataCard />
        </div>
      )}
    </div>
  );
}
