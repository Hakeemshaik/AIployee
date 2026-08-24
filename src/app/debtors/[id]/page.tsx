import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Banknote, CalendarClock, MessageSquare, PhoneCall } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, formatDateTime, money, relativeDays } from "@/lib/format";
import { getDebtorProfile } from "@/services/debtors";
import { promiseDisplayStatus } from "@/services/promises";
import { BackLink, Badge, GlassCard, Meta, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Debtor" };

const KIND_ICONS = {
  call: PhoneCall,
  sms: MessageSquare,
  promise: CalendarClock,
  payment: Banknote,
  escalation: AlertTriangle,
} as const;

export default async function DebtorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getContext();
  const profile = await getDebtorProfile(ctx.organizationId, id);
  if (!profile) notFound();
  const { debtor, stats, timeline } = profile;
  const account = debtor.accounts[0];
  const openPromise = stats.openPromise;

  return (
    <div className="page-in">
      <BackLink href="/debtors" label="All debtors" />
      <PageHeader
        title={`${debtor.firstName} ${debtor.lastName}`}
        description={`Account ${debtor.accountNumber}${account ? ` · ${account.creditorName}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge value={debtor.status} label={label(debtor.status)} />
            <Badge value={`risk_${stats.riskBand}`} label={`${label(stats.riskBand)} risk · ${debtor.riskScore}/100`} />
            {debtor.doNotContact && <Badge value="legal" label="Do not contact" />}
          </div>
        }
      />

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GlassCard title="Identity">
          <dl>
            <Meta label="Full name">{debtor.firstName} {debtor.lastName}</Meta>
            <Meta label="Account number"><span className="num">{debtor.accountNumber}</span></Meta>
            <Meta label="Phone"><span className="num">{debtor.phone}</span></Meta>
            <Meta label="Email">{debtor.email ?? "—"}</Meta>
            <Meta label="Location">{debtor.city ? `${debtor.city}, ${debtor.province}` : "—"}</Meta>
          </dl>
        </GlassCard>
        <GlassCard title="Debt">
          <dl>
            <Meta label="Original balance"><span className="num">{money(stats.originalBalance)}</span></Meta>
            <Meta label="Current balance"><span className="num font-semibold">{money(stats.outstanding)}</span></Meta>
            <Meta label="Amount paid"><span className="num text-[#5fc46a]">{money(stats.amountPaid)}</span></Meta>
            <Meta label="Days overdue"><span className="num">{stats.daysOverdue}</span></Meta>
            <Meta label="Original due date">{formatDate(stats.dueDate)}</Meta>
          </dl>
        </GlassCard>
        <GlassCard title="Collection status">
          <dl>
            <Meta label="Contact attempts"><span className="num">{stats.contactAttempts}</span></Meta>
            <Meta label="Successful contacts"><span className="num">{stats.successfulContacts}</span></Meta>
            <Meta label="Last contact">{formatDateTime(debtor.lastContactAt)}</Meta>
            <Meta label="Last outcome">
              {debtor.lastOutcome ? <Badge value={debtor.lastOutcome} label={label(debtor.lastOutcome)} /> : "—"}
            </Meta>
            <Meta label="Campaign">
              {debtor.campaign ? (
                <Link href={`/campaigns/${debtor.campaign.id}`} className="text-accent hover:underline">
                  {debtor.campaign.name}
                </Link>
              ) : (
                "Unassigned"
              )}
            </Meta>
          </dl>
        </GlassCard>
        <GlassCard title="Promise to pay">
          {openPromise ? (
            <dl>
              <Meta label="Promised amount"><span className="num font-semibold">{money(openPromise.amount)}</span></Meta>
              <Meta label="Promise date">
                {formatDate(openPromise.promisedDate)}{" "}
                <span className="text-ink-3">({relativeDays(openPromise.promisedDate)})</span>
              </Meta>
              <Meta label="Payment plan">
                {openPromise.paymentPlan
                  ? (() => {
                      const plan = JSON.parse(openPromise.paymentPlan!) as {
                        installments: number;
                        amount_per_installment: number;
                        frequency: string;
                      };
                      return `${plan.installments} × ${money(plan.amount_per_installment)} ${plan.frequency}`;
                    })()
                  : "Single payment"}
              </Meta>
              <Meta label="Status">
                <Badge
                  value={promiseDisplayStatus(openPromise)}
                  label={label(promiseDisplayStatus(openPromise))}
                />
              </Meta>
            </dl>
          ) : (
            <p className="py-4 text-[0.8125rem] text-ink-3">
              No open promise. {debtor.promises.length > 0 ? `${debtor.promises.length} historical promise${debtor.promises.length === 1 ? "" : "s"} in the timeline.` : ""}
            </p>
          )}
        </GlassCard>
      </div>

      <GlassCard title="Timeline" subtitle="Every interaction on this account, most recent first">
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem] text-ink-3">No interactions recorded yet.</p>
        ) : (
          <ol className="relative ml-2 space-y-5 border-l border-line pl-6">
            {timeline.map((entry) => {
              const Icon = KIND_ICONS[entry.kind];
              return (
                <li key={entry.id} className="relative">
                  <span className="absolute -left-[31px] flex h-5 w-5 items-center justify-center rounded-full border border-line bg-raised">
                    <Icon size={10} className="text-ink-2" />
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[0.75rem] text-ink-3">{formatDateTime(entry.at)}</span>
                    <span className="text-[0.8125rem] font-medium text-ink">
                      {entry.href ? (
                        <Link href={entry.href} className="hover:text-accent">{entry.title}</Link>
                      ) : (
                        entry.title
                      )}
                    </span>
                    {entry.kind === "call" && entry.callStatus && entry.callStatus !== "completed" && (
                      <Badge value={entry.callStatus} label={label(entry.callStatus)} />
                    )}
                    {entry.outcome && <Badge value={entry.outcome} label={label(entry.outcome)} />}
                    {entry.amount != null && (
                      <span className="num text-[0.8125rem] text-ink">{money(entry.amount)}</span>
                    )}
                    {entry.date && (
                      <span className="text-[0.75rem] text-ink-3">for {formatDate(entry.date)}</span>
                    )}
                  </div>
                  {entry.detail && (
                    <p className="mt-1 max-w-3xl text-[0.78125rem] leading-relaxed text-ink-2">{entry.detail}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </GlassCard>
    </div>
  );
}
