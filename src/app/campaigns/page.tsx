import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext, hasRole } from "@/lib/auth";
import { listCampaigns } from "@/services/campaigns";
import { EmptyState, PageHeader } from "@/components/ui";
import { CampaignList } from "./CampaignList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await getContext();
  const campaigns = await listCampaigns(ctx.organizationId);
  const canDelete = hasRole(ctx, ["admin", "manager"]);

  return (
    <div className="page-in">
      <PageHeader
        title="Campaigns"
        description="Collection campaigns and the AI agents working them."
        actions={
          <Link href="/campaigns/new" className="btn btn-primary">
            <Plus size={14} /> New campaign
          </Link>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          hint="Create a campaign to start assigning debtors to an AI voice agent."
          action={<Link href="/campaigns/new" className="btn btn-primary">Create campaign</Link>}
        />
      ) : (
        <CampaignList
          canDelete={canDelete}
          campaigns={campaigns.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            strategy: c.strategy,
            agentName: c.agentName ?? null,
            metrics: {
              totalDebtors: c.metrics.totalDebtors,
              totalDebt: c.metrics.totalDebt,
              contacted: c.metrics.contacted,
            },
          }))}
        />
      )}
    </div>
  );
}
