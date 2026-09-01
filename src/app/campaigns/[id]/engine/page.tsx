import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/ui";
import { getEngineState } from "@/services/engine/state";
import { EngineView } from "./EngineView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign engine" };

// ---------------------------------------------------------------------------
// The Campaign Engine screen: paste the book, call it in rounds, read who
// answered, cut the redial, close the campaign. Every stage the state machine
// has is a section here, and the section for the current stage leads.
// ---------------------------------------------------------------------------

export default async function EnginePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  const { id } = await params;
  const campaign = await db.campaign.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, name: true },
  });
  if (!campaign) {
    return (
      <div className="page-in">
        <BackLink href="/campaigns" label="All campaigns" />
        <PageHeader title="Campaign not found" />
      </div>
    );
  }

  const state = await getEngineState(ctx.organizationId, id);

  return (
    <div className="page-in">
      <BackLink href={`/campaigns/${id}`} label={campaign.name} />
      <PageHeader
        title="Campaign engine"
        description={`${campaign.name} — paste the book, call it in rounds, and close it with the report. Nothing here dials outside 06:00–21:00 SAST, on a Sunday, or on a public holiday.`}
      />
      <EngineView initial={JSON.parse(JSON.stringify(state))} campaignId={id} />
    </div>
  );
}
