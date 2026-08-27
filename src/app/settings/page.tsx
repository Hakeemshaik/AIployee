import { KeyRound, Webhook } from "lucide-react";
import { getContext } from "@/lib/auth";
import { EVENT_TYPES } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/services/settings";
import { setupStatus } from "@/services/setup-status";
import { SetupChecklist } from "@/components/SetupChecklist";
import { Badge, GlassCard, Meta, PageHeader } from "@/components/ui";
import { ComplianceForm } from "./ComplianceForm";
import { ResetDataCard } from "./ResetDataCard";
import { TeamCard } from "./TeamCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

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
  const aiLive = process.env.AI_PROVIDER === "claude" && !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="page-in">
      <PageHeader
        title="Settings"
        description={`Organization, compliance guardrails and integrations for ${org.name}.`}
      />

      <div className="mb-4">
        <SetupChecklist status={setup} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <GlassCard title="Organization">
          <dl>
            <Meta label="Name">{org.name}</Meta>
            <Meta label="Currency">{org.currency}</Meta>
            <Meta label="Timezone">{org.timezone}</Meta>
            <Meta label="Data isolation">Per-organization (multi-tenant)</Meta>
          </dl>
        </GlassCard>
        <GlassCard title="AI provider" subtitle="Analysis, insights and reporting engine">
          <dl>
            <Meta label="Active provider">
              <Badge value={aiLive ? "active" : "draft"} label={aiLive ? "Claude (Anthropic API)" : "Built-in engine"} />
            </Meta>
            <Meta label="Configuration">Server environment only</Meta>
          </dl>
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-3">
            Set <code className="text-ink-2">AI_PROVIDER=claude</code> and{" "}
            <code className="text-ink-2">ANTHROPIC_API_KEY</code> in the server environment to switch
            the analysis engine to Claude. Keys never reach the browser, and only aggregated,
            anonymised data is sent for insight generation.
          </p>
        </GlassCard>
        {ctx.userRole === "admin" ? (
          <TeamCard selfId={ctx.userId} />
        ) : (
          <GlassCard title="Team">
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
          </GlassCard>
        )}
      </div>

      <GlassCard
        className="mb-4"
        title="Compliance & guardrails"
        subtitle="Configurable per organization — enforced on campaigns and passed to the voice platform"
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
      </GlassCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard title="Voice platform integration" subtitle="Inbound webhook for completed calls">
          <div className="mb-3 flex items-start gap-3 rounded-lg border border-line bg-white/[0.03] p-3">
            <Webhook size={15} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-[0.78125rem] font-medium text-ink">
                POST <span className="num">/api/integrations/voice/call-completed</span>
              </p>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-3">
                Authenticated with a Bearer API key scoped to <code>voice:ingest</code>. The call is
                stored, the transcript analysed, promises and escalations created, and campaign
                metrics updated — one request drives the whole workflow.
              </p>
            </div>
          </div>
          <pre className="scroll-x rounded-lg border border-line bg-black/30 p-3 text-[0.65625rem] leading-relaxed text-ink-2">
            {EXAMPLE_PAYLOAD}
          </pre>
          <h3 className="mb-2 mt-4 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
            API keys
          </h3>
          <ul className="space-y-2">
            {apiKeys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 rounded-lg border border-line-2 bg-white/[0.02] px-3 py-2">
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
          <p className="mt-2 text-[0.65625rem] text-ink-3">
            Keys are stored as SHA-256 hashes; the full key is shown once at creation.
          </p>
        </GlassCard>

        <GlassCard title="Event architecture" subtitle="Internal events, persisted and replayable">
          <p className="mb-3 text-[0.78125rem] leading-relaxed text-ink-2">
            Every domain action emits a persisted platform event. Outbound webhooks or a queue
            consumer can attach to this stream to integrate payment providers, CRMs or data
            warehouses without touching core logic.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EVENT_TYPES.filter((t) => t !== "sms.sent").map((t) => (
              <span key={t} className="num rounded-md border border-line bg-white/[0.03] px-2 py-1 text-[0.6875rem] text-ink-2">
                {t}
              </span>
            ))}
          </div>
          <p className="mt-4 text-[0.6875rem] leading-relaxed text-ink-3">
            Audit logging is always on: ingestion, payments, status changes and settings edits are
            written to the audit log with actor attribution and no sensitive payload content.
          </p>
        </GlassCard>
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
