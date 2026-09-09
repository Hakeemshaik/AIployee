import { NextResponse } from "next/server";
import { authFailure, jobixFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext, requireRole } from "@/lib/auth";
import { CAMPAIGN_STATUSES } from "@/lib/domain";
import { updateCampaignStatus } from "@/services/campaigns";

const patchSchema = z.object({ status: z.enum(CAMPAIGN_STATUSES) });

// PATCH /api/campaigns/:id — lifecycle transitions (activate, pause, complete).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await apiContext();
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
    const denied = authFailure(err);
    if (denied) return denied;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[campaigns] update failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/campaigns/:id — remove a campaign, releasing its accounts.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "delete campaigns");
    const { id } = await params;
    const { deleteCampaign } = await import("@/services/campaign-control");
    return NextResponse.json(await deleteCampaign(ctx.organizationId, ctx.userId, id));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    // "Stop the live run first" is an answer, not a fault.
    const jobix = jobixFailure(err);
    if (jobix) return jobix;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[campaigns] delete failed:", err);
    return NextResponse.json({ error: message, message }, { status });
  }
}
