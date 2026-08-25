import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { assignDebtorCampaign } from "@/services/debtors";

const patchSchema = z.object({ campaignId: z.string().nullable() });

// PATCH /api/debtors/:id — reassign (or clear) the debtor's campaign.
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
    const debtor = await assignDebtorCampaign(ctx.organizationId, ctx.userId, id, parsed.data.campaignId);
    return NextResponse.json({ id: debtor.id, campaignId: debtor.campaignId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[debtors] update failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
