import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext, requireRole } from "@/lib/auth";
import { REDIAL_FILTERS } from "@/lib/domain";
import { createRedialBatch, previewRedial } from "@/services/redial";
import { ProviderError } from "@/services/voice";

const schema = z.object({
  filter: z.enum(REDIAL_FILTERS),
  maxRetries: z.coerce.number().int().min(1).max(30).optional(),
  /** Count only — used to confirm the batch size before dialling. */
  preview: z.boolean().optional(),
});

// POST /api/campaigns/:id/redial — create a filtered redial batch.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "redial contacts");
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }

    if (parsed.data.preview) {
      const preview = await previewRedial(
        ctx.organizationId,
        id,
        parsed.data.filter,
        parsed.data.maxRetries ?? 3,
      );
      return NextResponse.json(preview);
    }

    const result = await createRedialBatch({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      campaignId: id,
      filter: parsed.data.filter,
      maxRetries: parsed.data.maxRetries,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof ProviderError) {
      return NextResponse.json(
        { error: err.code, message: err.message, detail: err.detail },
        { status: err.code === "unsupported" || err.code === "not_configured" ? 501 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : message.includes("not permitted") ? 403 : 500;
    if (status === 500) console.error("[campaigns/redial] failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
