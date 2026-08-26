import Link from "next/link";
import { Eye } from "lucide-react";
import { getContext, hasRole } from "@/lib/auth";
import { isGuest } from "@/lib/session";
import {
  BUCKET_EXPLANATIONS,
  BUCKET_LABELS,
  METRIC_FORMULAS,
  classifyAccount,
} from "@/services/analytics/classify";
import { demoAccountRows, demoAnalytics, demoClassifiableAccounts, demoMeta } from "@/services/analytics/demo";
import { buildLiveAnalytics } from "@/services/analytics/live";
import { getIngestProgress } from "@/services/jobix/ingest";
import { loadJobixEnv } from "@/services/jobix/client";
import { PageHeader } from "@/components/ui";
import { AnalyticsView, type AnalyticsPayload } from "./AnalyticsView";
import { IngestionPanel, type Progress, type ServerDiagnostic } from "./IngestionPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call analytics" };

export default async function AnalyticsPage() {
  const guest = await isGuest();

  let payload: AnalyticsPayload;
  let ingestion: {
    initial: Progress | null;
    configured: boolean;
    disabledReason?: string;
    diagnostic?: ServerDiagnostic;
  };

  if (guest) {
    const meta = demoMeta();
    const { analytics } = demoAnalytics();
    const accounts = demoClassifiableAccounts();
    const classifiedById = new Map(accounts.map((a) => [a.accountId, classifyAccount(a)]));
    const rowMeta = new Map(demoAccountRows().map((r) => [r.accountId, r]));

    // A guest cannot ingest — the control is shown, disabled, with the reason.
    ingestion = {
      initial: null,
      configured: false,
      disabledReason: "Ingestion is disabled in the demo — sign in to pull live Jobix data.",
    };

    payload = {
      source: "demo",
      workspace: meta.workspace,
      campaignName: meta.campaignName,
      formulas: METRIC_FORMULAS,
      bucketLabels: BUCKET_LABELS,
      bucketExplanations: BUCKET_EXPLANATIONS,
      analytics,
      rows: accounts.map((a) => {
        const c = classifiedById.get(a.accountId)!;
        const m = rowMeta.get(a.accountId)!;
        return {
          accountId: a.accountId,
          name: m.name,
          phone: m.phone,
          unit: m.unit,
          building: m.building,
          balance: m.balance,
          bucket: c.bucket,
          attempts: c.attempts,
          bestDurationSeconds: c.bestDurationSeconds,
          tenantWords: c.tenantWords,
          hasPtp: m.outcome.ptpConfirmed,
          disputed: m.outcome.disputed,
          paidClaimed: m.outcome.paidClaimed,
          escalated: m.outcome.escalated,
          doNotCall: m.outcome.doNotCall,
        };
      }),
    };
  } else {
    const ctx = await getContext();
    const { result, rows } = await buildLiveAnalytics(ctx.organizationId);
    const lastRun = await getIngestProgress(ctx.organizationId);
    ingestion = {
      // Only the presence of credentials crosses to the client, never a value.
      configured: !!loadJobixEnv(),
      disabledReason: hasRole(ctx, ["admin", "manager"])
        ? undefined
        : "Only an admin or manager can run ingestion.",
      initial: lastRun
        ? (JSON.parse(JSON.stringify(lastRun)) as Progress)
        : null,
      // What THIS deployment can actually see — presence booleans and build
      // identity only, never values. Exists because "the variable is set in
      // Vercel" and "the running function received it" are different facts,
      // and debugging the gap by screenshot wastes everyone's day.
      // Admins only — it is an ops diagnostic, not an operator control.
      diagnostic: hasRole(ctx, ["admin"])
        ? {
            vercelEnv: process.env.VERCEL_ENV ?? null,
            branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
            commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
            vars: {
              JOBIX_EMAIL: !!process.env.JOBIX_EMAIL,
              JOBIX_PASSWORD: !!process.env.JOBIX_PASSWORD,
              JOBIX_TOKEN: !!process.env.JOBIX_TOKEN,
              JOBIX_COMPANY_KEY: !!process.env.JOBIX_COMPANY_KEY,
              JOBIX_FLOW_UUID: !!process.env.JOBIX_FLOW_UUID,
              JOBIX_TRIGGER_NODE_UUID: !!process.env.JOBIX_TRIGGER_NODE_UUID,
            },
          }
        : undefined,
    };
    const classifiedById = new Map(result.classified.map((c) => [c.accountId, c]));
    payload = {
      source: "live",
      workspace: ctx.organizationName,
      campaignName: "All campaigns",
      formulas: METRIC_FORMULAS,
      bucketLabels: BUCKET_LABELS,
      bucketExplanations: BUCKET_EXPLANATIONS,
      analytics: result.analytics,
      rows: rows.map((r) => {
        const c = classifiedById.get(r.accountId)!;
        return {
          accountId: r.accountId,
          name: r.name,
          phone: r.phone,
          unit: r.accountNumber,
          building: r.building,
          balance: r.balance,
          bucket: c.bucket,
          attempts: c.attempts,
          bestDurationSeconds: c.bestDurationSeconds,
          tenantWords: c.tenantWords,
          hasPtp: r.outcome.ptpConfirmed ?? false,
          disputed: r.outcome.disputed ?? false,
          paidClaimed: r.outcome.paidClaimed ?? false,
          escalated: r.outcome.escalated ?? false,
          doNotCall: r.outcome.doNotCall ?? false,
        };
      }),
    };
  }

  return (
    <div className="page-in">
      {payload.source === "demo" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.07)] px-4 py-2.5">
          <p className="flex items-center gap-2 text-[0.8125rem] text-[#f2c14e]">
            <Eye size={14} /> Demo data — no live accounts. Calling is disabled.
          </p>
          <Link href="/login" className="btn btn-ghost text-[0.71875rem]">Leave demo</Link>
        </div>
      )}
      <PageHeader
        title="Call analytics"
        description={`${payload.campaignName} · Workspace ${payload.workspace}. Every account classified by whether a real human conversation happened.`}
      />
      <IngestionPanel
        initial={ingestion.initial}
        configured={ingestion.configured}
        disabledReason={ingestion.disabledReason}
        diagnostic={ingestion.diagnostic}
      />
      <AnalyticsView payload={JSON.parse(JSON.stringify(payload))} canCall={payload.source === "live"} />
    </div>
  );
}
