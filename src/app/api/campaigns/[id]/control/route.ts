import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext, requireRole } from "@/lib/auth";
import { pauseCampaign, startCampaign, stopCampaign } from "@/services/campaign-control";
import { ProviderError } from "@/services/voice";

const schema = z.object({ action: z.enum(["start", "pause", "stop"]) });

// POST /api/campaigns/:id/control — drive the voice provider.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "control campaigns");
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
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
    const denied = authFailure(err);
    if (denied) return denied;
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
