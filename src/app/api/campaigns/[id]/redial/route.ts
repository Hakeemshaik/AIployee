import { NextResponse } from "next/server";
import { authFailure, jobixFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext, requireRole } from "@/lib/auth";
import { REDIAL_FILTERS } from "@/lib/domain";
import { createRedialBatch, previewRedial } from "@/services/redial";

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
    // A refusal from the redial engine — nothing matches the filter, or every
    // match is over the attempt limit — is an answer, not a failure.
    const jobix = jobixFailure(err);
    if (jobix) return jobix;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : message.includes("not permitted") ? 403 : 500;
    if (status === 500) console.error("[campaigns/redial] failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
