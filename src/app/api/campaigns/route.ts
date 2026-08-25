import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createCampaign, createCampaignSchema } from "@/services/campaigns";

// POST /api/campaigns — create a collection campaign.
export async function POST(request: Request) {
  try {
    const ctx = await getContext();
    const body = await request.json();
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const campaign = await createCampaign(ctx.organizationId, ctx.userId, parsed.data);
    return NextResponse.json({ id: campaign.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[campaigns] creation failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
