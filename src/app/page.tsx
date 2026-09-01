import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  PhoneCall,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { getContext } from "@/lib/auth";
import { setupStatus } from "@/services/setup-status";
import { SetupChecklist } from "@/components/SetupChecklist";
import { label } from "@/lib/domain";
import { count, formatDateTime, money, percent, relativeDays } from "@/lib/format";
import { getDashboardData, getWorkQueue } from "@/services/dashboard";
import { Badge, Card, Disclosure, Gauge, PageHeader, Sparkline, StatCard } from "@/components/ui";
import {
  AgingChart,
  ContactActivityChart,
  HBarChart,
  PaymentsBarChart,
  PromiseConversionChart,
  RecoveryTrendChart,
} from "@/components/charts";
import { RefreshInsightsButton } from "@/components/actions/RefreshInsights";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The dashboard reads top to bottom as four questions:
//
//   1. Where does the book stand      four numbers
//   2. What needs a person today      one list, most urgent first
//   3. Is it getting better           two trends
//   4. Everything else                closed until asked for
//
// It used to open with ten figures of equal weight and six charts below them,
// which is a wall rather than an answer. Nothing has been removed — the detail
// moved into the last section.
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  const ctx = await getContext();
  const [data, queue, setup] = await Promise.all([
    getDashboardData(ctx.organizationId),
    getWorkQueue(ctx.organizationId),
    setupStatus(ctx.organizationId),
  ]);
  const m = data.metrics;
  const insight = data.insight;

  const attempts = data.contactSeries.reduce((s, d) => s + d.attempts, 0);
  const connected = data.contactSeries.reduce((s, d) => s + d.connected, 0);
  // The shape behind each figure, at tile size. A number with its own line
  // under it answers "is this getting better" without a second look.
  const recoveredSpark = data.recoverySeries.map((d) => d.cumulative);
  const paidSpark = data.recoverySeries.map((d) => d.received);
  // A day's reach ratio swings between 0 and 1 on a handful of calls, which in
  // a tile reads as noise rather than a trend. Seven days trailing is the
  // shortest window that shows the direction instead of the weather.
  const reachSpark = data.contactSeries.map((_, index) => {
    const window = data.contactSeries.slice(Math.max(0, index - 6), index + 1);
    const tried = window.reduce((total, day) => total + day.attempts, 0);
    const got = window.reduce((total, day) => total + day.connected, 0);
    return tried > 0 ? got / tried : 0;
  });

  // One list, ordered by how much a delay costs: a promise going unchased, then
  // an escalation nobody has picked up, then somebody who asked to be called.
  const work = [
    ...queue.duePromises.map((p) => ({
      key: `p-${p.id}`,
      href: `/debtors/${p.debtor.id}`,
      icon: CalendarClock,
      who: `${p.debtor.firstName} ${p.debtor.lastName}`,
      what: `Promised ${money(p.amount)}`,
      when: relativeDays(p.promisedDate),
      badge: null as { value: string; label: string } | null,
    })),
    ...queue.escalations.map((e) => ({
      key: `e-${e.id}`,
      href: `/debtors/${e.debtor.id}`,
      icon: AlertTriangle,
      who: `${e.debtor.firstName} ${e.debtor.lastName}`,
      what: "Escalation waiting",
      when: "",
      badge: { value: e.reason, label: label(e.reason) },
    })),
    ...queue.callbacks.map((c) => ({
      key: `c-${c.id}`,
      href: `/debtors/${c.call.debtor.id}`,
      icon: PhoneCall,
      who: `${c.call.debtor.firstName} ${c.call.debtor.lastName}`,
      what: "Asked for a callback",
      when: relativeDays(c.call.startedAt),
      badge: null,
    })),
  ];
  const shown = work.slice(0, 8);

  return (
    <div className="page-in">
      <PageHeader
        title="Dashboard"
        description="Where the book stands, and what needs a person today. Last 30 days unless stated."
      />

      {/* Only while there is something left to do — a finished setup does not
          need a permanent checklist taking the top of the dashboard. */}
      {setup.done < setup.total && <SetupChecklist status={setup} compact />}

      {/* 1 — where the book stands.
          Four identical tiles, deliberately. They were four different washes
          with the first one a size larger, which made the row read as four
          unrelated things and put nothing on a common line — labels at two
          heights, figures at two sizes. One surface, one size, each figure
          carrying the shape of how it got there. The only difference between
          the tiles is the number, which is the only difference there is. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          i={0}
          label="Outstanding"
          value={money(m.totalOutstanding)}
          sub="across the full book"
          icon={<Wallet size={12} className="text-ink-3" />}
        />
        <StatCard
          i={1}
          label="Recovered"
          value={money(m.totalRecovered)}
          tone="good"
          spark={recoveredSpark}
          sub={`${percent(m.recoveryRate)} of the book, all time`}
          icon={<TrendingUp size={12} className="text-ink-3" />}
        />
        <StatCard
          i={2}
          label="Promised, unpaid"
          value={money(m.promiseValue)}
          meter={m.totalOutstanding > 0 ? m.promiseValue / m.totalOutstanding : 0}
          sub={`${m.promisesOpen} open promise${m.promisesOpen === 1 ? "" : "s"} · share of the book`}
          icon={<CalendarClock size={12} className="text-ink-3" />}
        />
        <StatCard
          i={3}
          label="Reached"
          value={attempts > 0 ? percent(connected / attempts) : "—"}
          spark={reachSpark}
          sub={`${m.successfulContacts} of ${attempts} attempts · 7-day trend`}
          icon={<PhoneCall size={12} className="text-ink-3" />}
        />
      </div>

      {/* 2 — what needs a person, and what the analysis makes of it */}
      <div className="mb-4 grid items-start gap-4 xl:grid-cols-3">
        <Card
          i={0}
          className="xl:col-span-2"
          title="Needs a person today"
          subtitle={
            work.length === 0
              ? "Nothing waiting — promises are on schedule and no escalation is open"
              : `${work.length} item${work.length === 1 ? "" : "s"}, most urgent first`
          }
          actions={
            work.length > 0 ? (
              <Link
                href="/promises?status=overdue"
                className="inline-flex items-center gap-1 text-[0.75rem] text-accent-ink hover:underline"
              >
                All overdue <ArrowRight size={12} />
              </Link>
            ) : undefined
          }
        >
          {work.length === 0 ? (
            <p className="py-8 text-center text-[0.8125rem] text-ink-3">
              All clear. Nothing is overdue and no escalation is waiting.
            </p>
          ) : (
            <ul className="-mx-2">
              {shown.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="row-hover group flex items-center gap-3 px-2 py-2"
                  >
                    <item.icon size={14} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink group-hover:text-accent-ink">
                      {item.who}
                    </span>
                    {/* Two fixed columns on the right, so the reasons start on
                        one line and the badges end on one line. Sized to the
                        content and right-aligned, they were ragged on both
                        edges — the eye had nothing to run down. */}
                    <span className="hidden w-[9.5rem] shrink-0 truncate text-right text-[0.75rem] text-ink-2 sm:block">
                      {item.what}
                    </span>
                    <span className="flex w-[7.5rem] shrink-0 justify-end">
                      {item.badge ? (
                        <Badge value={item.badge.value} label={item.badge.label} />
                      ) : (
                        <span className="text-[0.71875rem] text-ink-3">{item.when}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
              {work.length > shown.length && (
                <li className="px-2 pt-2 text-[0.71875rem] text-ink-3">
                  and {work.length - shown.length} more —{" "}
                  <Link href="/escalations?status=open" className="text-accent-ink hover:underline">
                    open the queue
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Card>

        <Card
          i={1}
          title="Latest analysis"
          subtitle={
            insight
              ? `${formatDateTime(insight.generatedAt)} · ${insight.provider === "claude" ? "Claude" : "built-in engine"}`
              : "Nothing generated yet"
          }
          actions={<RefreshInsightsButton scope="dashboard" />}
        >
          {insight ? (
            <div>
              <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-ink">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
                {insight.content.headline}
              </p>
              <ul className="mt-3.5 space-y-2.5 border-t border-line-2 pt-3.5">
                {insight.content.recommendedActions.slice(0, 2).map((a, i) => (
                  <li key={i} className="flex gap-2.5 text-[0.78125rem] leading-relaxed text-ink-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        a.priority === "high"
                          ? "bg-serious"
                          : a.priority === "medium"
                            ? "bg-warning"
                            : "bg-accent"
                      }`}
                      title={`${label(a.priority)} priority`}
                    />
                    {/* Clamped: the point is which two things to do, not the
                        whole argument for each — that is on the insights page,
                        one link below. */}
                    <span className="line-clamp-3">
                      <span className="font-medium text-ink">{a.title}.</span> {a.detail}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/insights"
                className="mt-3.5 inline-flex items-center gap-1 text-[0.75rem] text-accent-ink hover:underline"
              >
                Findings and the rest of the actions <ArrowRight size={12} />
              </Link>
            </div>
          ) : (
            <p className="text-[0.8125rem] leading-relaxed text-ink-2">
              Regenerate to analyse the last 30 days of collection activity.
            </p>
          )}
        </Card>
      </div>

      {/* 3 — is it getting better.
          Plots on white cards, single figures on washed ones: the series
          colours are validated against white and lose their separation over a
          tint, so the two never share a surface. */}
      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card
          i={0}
          className="xl:col-span-2"
          title="Recovery over time"
          subtitle="Cumulative rand recovered, last 30 days"
        >
          <RecoveryTrendChart data={data.recoverySeries} />
        </Card>
        <Card i={1} title="Reach" subtitle="Connected calls as a share of attempts">
          <div className="pt-2">
            <Gauge
              value={attempts > 0 ? connected / attempts : 0}
              label={`${count(connected)} of ${count(attempts)} attempts`}
              caption="Last 30 days. A reached call is one a person answered."
            />
          </div>
        </Card>
        <Card
          i={2}
          className="xl:col-span-2"
          title="Contact success"
          subtitle="Daily call attempts and connections"
        >
          <ContactActivityChart data={data.contactSeries} />
        </Card>
        <Card i={3} title="Payments in" subtitle="Day by day, last 30 days">
          <p className="num text-[1.5rem] font-semibold leading-none tracking-tight text-ink">
            {money(m.paymentsValue)}
          </p>
          <p className="mt-1.5 text-[0.71875rem] text-ink-3">
            across {m.paymentsReceived} payment{m.paymentsReceived === 1 ? "" : "s"}
          </p>
          <Sparkline values={paidSpark} height={64} className="mt-4" />
        </Card>
      </div>

      {/* 4 — everything else */}
      <Disclosure summary="The rest of the numbers" hint="book age, conversion, payments, campaigns">
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Debtors contacted" value={String(m.debtorsContacted)} sub="last 30 days" />
          <StatCard label="Successful contacts" value={String(m.successfulContacts)} sub="reached and spoke" />
          <StatCard
            label="Payments received"
            value={String(m.paymentsReceived)}
            sub={`${money(m.paymentsValue)} in 30 days`}
          />
          <StatCard label="Active campaigns" value={String(m.activeCampaigns)} sub="dialling now" />
          <StatCard label="Recovery rate" value={percent(m.recoveryRate)} sub="recovered vs total book" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Book by account age" subtitle="Outstanding vs recovered per aging bucket">
            <AgingChart data={data.agingSeries} />
          </Card>
          <Card title="Promise-to-pay conversion" subtitle="Weekly promises created vs fulfilled">
            <PromiseConversionChart data={data.promiseSeries} />
          </Card>
          <Card title="Payments received" subtitle="Daily rand value received, last 30 days">
            <PaymentsBarChart data={data.recoverySeries} />
          </Card>
          <Card title="Campaign performance" subtitle="Rand recovered per campaign">
            {data.campaignSeries.length ? (
              <HBarChart
                money
                data={data.campaignSeries.map((c) => ({ label: c.name, value: c.recovered }))}
              />
            ) : (
              <p className="py-8 text-center text-[0.8125rem] text-ink-3">No campaign data yet.</p>
            )}
          </Card>
          <Card title="Collection outcomes" subtitle="Connected-call outcomes, last 30 days">
            {data.outcomeSeries.length ? (
              <HBarChart
                data={data.outcomeSeries.slice(0, 8).map((o) => ({ label: label(o.outcome), value: o.count }))}
              />
            ) : (
              <p className="py-8 text-center text-[0.8125rem] text-ink-3">No analysed calls yet.</p>
            )}
          </Card>
          {insight && insight.content.keyFindings.length > 0 && (
            <Card title="Key findings" subtitle="From the latest analysis">
              <ul className="space-y-2.5">
                {insight.content.keyFindings.slice(0, 4).map((f, i) => (
                  <li key={i} className="text-[0.8125rem] leading-relaxed text-ink-2">
                    <span className="font-medium text-ink">{f.title}.</span> {f.detail}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
