import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext, requireRole } from "@/lib/auth";
import { pauseCampaign, startCampaign, stopCampaign } from "@/services/campaign-control";
import { startNextBatch } from "@/services/campaign-batches";
import { resyncCampaign } from "@/services/campaign-resync";
import { ProviderError } from "@/services/voice";

const schema = z.object({
  action: z.enum(["start", "batch", "resync", "pause", "stop"]),
  /** batch only — override the campaign's configured batch size for one run. */
  size: z.coerce.number().int().min(1).max(2000).optional(),
});

// POST /api/campaigns/:id/control — drive the voice provider.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getContext();
    requireRole(ctx, ["admin", "manager"], "control campaigns");
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }

    // "batch" releases the next slice of never-dialled contacts; "start"
    // remains the release-everything path for callers that want it.
    if (parsed.data.action === "batch") {
      const result = await startNextBatch({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        campaignId: id,
        size: parsed.data.size,
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (parsed.data.action === "resync") {
      const result = await resyncCampaign(ctx.organizationId, ctx.userId, id);
      return NextResponse.json(result);
    }
    if (parsed.data.action === "start") {
      const result = await startCampaign(ctx.organizationId, ctx.userId, id);
      return NextResponse.json(result);
    }
    const result =
      parsed.data.action === "pause"
        ? await pauseCampaign(ctx.organizationId, ctx.userId, id)
        : await stopCampaign(ctx.organizationId, ctx.userId, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProviderError) {
      // The operator sees the real integration error, never a fake success.
      return NextResponse.json(
        { error: err.code, message: err.message, detail: err.detail },
        { status: err.code === "unsupported" || err.code === "not_configured" ? 501 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : message.includes("not permitted") ? 403 : 500;
    if (status === 500) console.error("[campaigns/control] failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
