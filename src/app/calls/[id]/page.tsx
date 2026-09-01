import Link from "next/link";
import { notFound } from "next/navigation";
import { AudioLines, Sparkles } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { duration, formatDate, formatDateTime, formatTime, money } from "@/lib/format";
import { getCall } from "@/services/calls";
import { BackLink, Badge, Card, Meta, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call" };

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getContext();
  const result = await getCall(ctx.organizationId, id);
  if (!result) notFound();
  const { call, related } = result;
  const analysis = call.analysis;
  const keyPoints: string[] = analysis?.keyPoints ? JSON.parse(analysis.keyPoints) : [];
  const plan = analysis?.paymentPlan
    ? (JSON.parse(analysis.paymentPlan) as { installments: number; amount_per_installment: number; frequency: string })
    : null;

  const extraction = analysis
    ? {
        outcome: analysis.outcome,
        promised_amount: analysis.promisedAmount,
        promised_date: analysis.promisedDate ? analysis.promisedDate.toISOString().slice(0, 10) : null,
        payment_plan: plan,
        reason_for_nonpayment: analysis.reasonForNonpayment,
        sentiment: analysis.sentiment,
        requires_human: analysis.requiresHuman,
        next_action: analysis.nextAction,
      }
    : null;

  return (
    <div className="page-in">
      <BackLink href="/calls" label="All calls" />
      <PageHeader
        title={`Call with ${call.debtor.firstName} ${call.debtor.lastName}`}
        description={`${formatDateTime(call.startedAt)} · ${duration(call.durationSeconds)} · ${call.agent?.name ?? "Unknown agent"}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge value={call.status} label={label(call.status)} />
            {analysis && <Badge value={analysis.outcome} label={label(analysis.outcome)} />}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* AI summary + extraction */}
          <Card
            title="AI analysis"
            subtitle={analysis ? `Analysed by ${analysis.provider === "claude" ? "Claude" : "the built-in engine"}` : undefined}
          >
            {analysis ? (
              <div>
                <p className="mb-4 flex items-start gap-2 text-[0.875rem] leading-relaxed text-ink">
                  <Sparkles size={15} className="mt-1 shrink-0 text-accent" />
                  {analysis.summary}
                </p>
                {keyPoints.length > 0 && (
                  <ul className="mb-4 list-disc space-y-1 pl-5 text-[0.8125rem] text-ink-2">
                    {keyPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <dl>
                    <Meta label="Outcome"><Badge value={analysis.outcome} label={label(analysis.outcome)} /></Meta>
                    <Meta label="Promised amount">{analysis.promisedAmount != null ? <span className="num">{money(analysis.promisedAmount)}</span> : "—"}</Meta>
                    <Meta label="Promised date">{formatDate(analysis.promisedDate)}</Meta>
                    <Meta label="Payment plan">
                      {plan ? `${plan.installments} × ${money(plan.amount_per_installment)} ${plan.frequency}` : "—"}
                    </Meta>
                  </dl>
                  <dl>
                    <Meta label="Reason for non-payment">{analysis.reasonForNonpayment ? label(analysis.reasonForNonpayment) : "—"}</Meta>
                    <Meta label="Sentiment"><Badge value={analysis.sentiment} label={label(analysis.sentiment)} /></Meta>
                    <Meta label="Requires human">{analysis.requiresHuman ? <Badge value="urgent" label={`Yes — ${label(analysis.escalationReason ?? "review")}`} /> : "No"}</Meta>
                    <Meta label="Next action">{analysis.nextAction ? label(analysis.nextAction) : "—"}</Meta>
                  </dl>
                </div>
                <details className="mt-4">
                  <summary className="cursor-pointer text-[0.71875rem] text-ink-3 hover:text-ink-2">
                    Structured extraction (JSON)
                  </summary>
                  <pre className="scroll-x mt-2 rounded-lg border border-line bg-black/30 p-3 text-[0.6875rem] leading-relaxed text-ink-2">
                    {JSON.stringify(extraction, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-[0.8125rem] text-ink-3">This call has not been analysed.</p>
            )}
          </Card>

          {/* Transcript */}
          <Card title="Transcript">
            {call.transcript ? (
              <div className="space-y-3">
                {call.transcript.split("\n").filter(Boolean).map((line, i) => {
                  const match = line.match(/^([^:]{2,40}):\s*(.*)$/);
                  const speaker = match?.[1] ?? "";
                  const text = match?.[2] ?? line;
                  const isAgent = /\(AI\)|agent/i.test(speaker);
                  return (
                    <div key={i} className={`flex ${isAgent ? "" : "justify-end"}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[0.8125rem] leading-relaxed ${
                          isAgent
                            ? "rounded-tl-sm border border-line bg-white/[0.04] text-ink-2"
                            : "rounded-tr-sm border border-accent/25 bg-accent/10 text-ink"
                        }`}
                      >
                        {speaker && (
                          <p className={`mb-0.5 text-[0.625rem] font-medium uppercase tracking-[0.07em] ${isAgent ? "text-accent" : "text-ink-3"}`}>
                            {speaker}
                          </p>
                        )}
                        {text}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[0.8125rem] text-ink-3">
                No transcript for this call{call.status !== "completed" ? ` — the call was not answered (${label(call.status).toLowerCase()}).` : "."}
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Call metadata">
            <dl>
              <Meta label="Debtor">
                <Link href={`/debtors/${call.debtor.id}`} className="text-accent hover:underline">
                  {call.debtor.firstName} {call.debtor.lastName}
                </Link>
              </Meta>
              <Meta label="Account"><span className="num">{call.debtor.accountNumber}</span></Meta>
              <Meta label="Agent">
                {call.agent ? (
                  <Link href={`/agents/${call.agent.id}`} className="text-accent hover:underline">{call.agent.name}</Link>
                ) : "—"}
              </Meta>
              <Meta label="Campaign">
                {call.campaign ? (
                  <Link href={`/campaigns/${call.campaign.id}`} className="text-accent hover:underline">{call.campaign.name}</Link>
                ) : "—"}
              </Meta>
              <Meta label="Direction">{label(call.direction)}</Meta>
              <Meta label="Started">{formatDateTime(call.startedAt)}</Meta>
              <Meta label="Ended">{call.endedAt ? formatTime(call.endedAt) : "—"}</Meta>
              <Meta label="Duration"><span className="num">{duration(call.durationSeconds)}</span></Meta>
              <Meta label="External call ID"><span className="num text-[0.71875rem]">{call.externalCallId ?? "—"}</span></Meta>
            </dl>
          </Card>

          <Card title="Recording">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-white/[0.03] p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white/[0.04]">
                <AudioLines size={16} className="text-ink-2" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.78125rem] font-medium text-ink">
                  {call.recordingUrl ? "Recording available on the voice platform" : "No recording attached"}
                </p>
                <p className="truncate text-[0.6875rem] text-ink-3">
                  {call.recordingUrl ?? "The voice platform can attach a recordingUrl via the integration API."}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-3">
              Playback stays on the voice platform in this MVP — recordings are referenced, never copied.
            </p>
          </Card>

          <Card title="Other calls with this debtor">
            {related.length === 0 ? (
              <p className="text-[0.8125rem] text-ink-3">This is the only call on record.</p>
            ) : (
              <ul className="space-y-2.5">
                {related.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-[0.78125rem]">
                    <Link href={`/calls/${r.id}`} className="text-ink-2 hover:text-accent">
                      {formatDateTime(r.startedAt)}
                    </Link>
                    <Badge
                      value={r.analysis?.outcome ?? r.status}
                      label={label(r.analysis?.outcome ?? r.status)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
