import Link from "next/link";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/format";
import { listCampaignOptions } from "@/services/debtors";
import { listReports } from "@/services/reports";
import { Badge, EmptyState, Card, PageHeader } from "@/components/ui";
import { GenerateReportControl } from "./GenerateReport";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await getContext();
  const [reports, campaigns] = await Promise.all([
    listReports(ctx.organizationId),
    listCampaignOptions(ctx.organizationId),
  ]);

  return (
    <div className="page-in">
      <PageHeader
        title="Reports"
        description="AI-written collection reports built from a frozen data snapshot, so past reports never drift."
        actions={<GenerateReportControl campaigns={campaigns} />}
      />
      <Card pad={false}>
        {reports.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No reports yet" hint="Generate your first report using the control above." />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Engine</th>
                  <th>Generated</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/reports/${r.id}`} className="font-medium text-ink hover:text-accent">
                        {r.title}
                      </Link>
                    </td>
                    <td className="text-ink-3">{label(r.type)}</td>
                    <td className="text-ink-3">
                      {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
                    </td>
                    <td><Badge value={r.status} label={label(r.status)} /></td>
                    <td className="text-ink-3">{r.provider === "claude" ? "Claude" : "Built-in"}</td>
                    <td className="text-ink-3">{formatDateTime(r.generatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
