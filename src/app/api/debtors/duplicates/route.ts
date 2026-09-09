import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { findDuplicates, mergeDuplicates } from "@/services/duplicates";

export const maxDuration = 60;

// GET /api/debtors/duplicates — what would be merged, and nothing written.
export async function GET() {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "review duplicate accounts");
    return NextResponse.json(await findDuplicates(ctx.organizationId));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[debtors/duplicates] scan failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

const schema = z.object({
  // Naming the groups is the confirmation. There is deliberately no
  // "merge everything" — a merge cannot be undone.
  groupKeys: z.array(z.string().min(1)).min(1).max(500),
  confirmed: z.literal(true),
});

// POST /api/debtors/duplicates — merge the named groups into their keepers.
export async function POST(request: Request) {
  try {
    await blockGuests("merge duplicate accounts");
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "merge duplicate accounts");
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", message: "Name the groups to merge and confirm." },
        { status: 422 },
      );
    }
    return NextResponse.json(
      await mergeDuplicates(ctx.organizationId, ctx.userId, parsed.data.groupKeys),
    );
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[debtors/duplicates] merge failed:", err);
    return NextResponse.json({ error: message, message }, { status: 500 });
  }
}
