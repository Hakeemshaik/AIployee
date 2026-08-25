import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { CAMPAIGN_STATUSES } from "@/lib/domain";
import { updateCampaignStatus } from "@/services/campaigns";

const patchSchema = z.object({ status: z.enum(CAMPAIGN_STATUSES) });

// PATCH /api/campaigns/:id — lifecycle transitions (activate, pause, complete).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getContext();
    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const campaign = await updateCampaignStatus(ctx.organizationId, ctx.userId, id, parsed.data.status);
    return NextResponse.json({ id: campaign.id, status: campaign.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[campaigns] update failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
