import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { BackLink, GlassCard, PageHeader } from "@/components/ui";
import { CampaignForm } from "./CampaignForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const ctx = await getContext();
  const agents = await db.aIAgent.findMany({
    where: { organizationId: ctx.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="page-in mx-auto max-w-2xl">
      <BackLink href="/campaigns" label="All campaigns" />
      <PageHeader title="New campaign" description="Define the segment, the agent, and the dialling rules." />
      <GlassCard>
        <CampaignForm agents={agents} />
      </GlassCard>
    </div>
  );
}
