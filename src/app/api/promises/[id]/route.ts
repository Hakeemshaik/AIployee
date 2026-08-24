import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { cancelPromise } from "@/services/promises";

// PATCH /api/promises/:id — currently supports { action: "cancel" }.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getContext();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.action !== "cancel") {
      return NextResponse.json({ error: "unsupported_action" }, { status: 422 });
    }
    await cancelPromise(ctx.organizationId, ctx.userId, id);
    return NextResponse.json({ id, status: "cancelled" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : message.includes("Only pending") ? 409 : 500;
    if (status === 500) console.error("[promises] update failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
