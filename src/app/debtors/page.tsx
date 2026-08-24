import Link from "next/link";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, money } from "@/lib/format";
import { listCampaignOptions, listDebtors, type DebtorFilters as Filters } from "@/services/debtors";
import { Badge, EmptyState, GlassCard, PageHeader } from "@/components/ui";
import { DebtorFilters } from "./Filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Debtors" };

function parseRange(value?: string): [number | undefined, number | undefined] {
  if (!value) return [undefined, undefined];
  const [min, max] = value.split("-");
  return [min ? Number(min) : undefined, max ? Number(max) : undefined];
}

export default async function DebtorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getContext();

  const [minAmount, maxAmount] = parseRange(params.amount);
  const [minDaysOverdue, maxDaysOverdue] = parseRange(params.overdue);
  const filters: Filters = {
    search: params.q,
    status: params.status,
    campaignId: params.campaign,
    risk: params.risk as Filters["risk"],
    minAmount,
    maxAmount,
    minDaysOverdue,
    maxDaysOverdue,
    lastContactDays: params.contact ? Number(params.contact) : undefined,
    promiseStatus: params.promise as Filters["promiseStatus"],
  };

  const [rows, campaigns] = await Promise.all([
    listDebtors(ctx.organizationId, filters),
    listCampaignOptions(ctx.organizationId),
  ]);
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  return (
    <div className="page-in">
      <PageHeader
        title="Debtors"
        description={`${rows.length} account${rows.length === 1 ? "" : "s"} · ${money(totalOutstanding)} outstanding in view`}
      />
      <DebtorFilters campaigns={campaigns} />
      <GlassCard pad={false}>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No debtors match these filters"
              hint="Adjust or clear the filters above. New debtors arrive via import or the API."
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Account</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Days overdue</th>
                  <th>Last contact</th>
                  <th>Last outcome</th>
                  <th className="text-right">Promise</th>
                  <th>Promise date</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Campaign</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/debtors/${r.id}`} className="font-medium text-ink hover:text-accent">
                        {r.name}
                      </Link>
                    </td>
                    <td className="num text-ink-3">{r.accountNumber}</td>
                    <td className="num text-right font-medium text-ink">{money(r.outstanding)}</td>
                    <td className="num text-right">{r.daysOverdue}</td>
                    <td>{formatDate(r.lastContactAt)}</td>
                    <td>{r.lastOutcome ? <Badge value={r.lastOutcome} label={label(r.lastOutcome)} /> : "—"}</td>
                    <td className="num text-right">{r.promiseAmount != null ? money(r.promiseAmount) : "—"}</td>
                    <td>{formatDate(r.promiseDate)}</td>
                    <td><Badge value={r.status} label={label(r.status)} /></td>
                    <td><Badge value={`risk_${r.riskBand}`} label={`${label(r.riskBand)} · ${r.riskScore}`} /></td>
                    <td className="max-w-[180px] truncate text-ink-3">{r.campaignName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
