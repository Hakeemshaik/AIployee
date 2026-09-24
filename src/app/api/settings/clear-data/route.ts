import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext, requireRole } from "@/lib/auth";
import { CLEAR_SCOPES, clearOrganizationData, previewClear } from "@/services/reset";

export const runtime = "nodejs";

const schema = z.object({
  scope: z.enum(CLEAR_SCOPES).default("operational"),
  /**
   * The organization's exact name. Typing it is what separates "clear the demo
   * data" from "clear the live book" — an id in a URL is far too easy to get
   * wrong, and none of this is recoverable.
   */
  confirm: z.string().optional(),
  /** Count what would go without deleting it. */
  preview: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await getContext();
    requireRole(ctx, ["admin"], "clear organization data");

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }

    const org = await db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true },
    });
    if (!org) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (parsed.data.preview) {
      return NextResponse.json({
        organization: org.name,
        scope: parsed.data.scope,
        counts: await previewClear(ctx.organizationId, parsed.data.scope),
      });
    }

    if (parsed.data.confirm?.trim() !== org.name) {
      return NextResponse.json(
        {
          error: "confirmation_mismatch",
          message: `Type the organization name exactly — "${org.name}" — to confirm.`,
        },
        { status: 400 },
      );
    }

    const result = await clearOrganizationData(
      ctx.organizationId,
      ctx.userId,
      parsed.data.scope,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not permitted") ? 403 : message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[settings/clear-data] failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
