import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { createPromise, createPromiseSchema } from "@/services/promises";

// POST /api/promises — write down a commitment somebody made.
//
// A promise used to be born only on a call, which left nowhere to put the one
// made when a person phones in, replies to a message, or says it at a counter.
export async function POST(request: Request) {
  try {
    await blockGuests("record a promise to pay");
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager", "collector"], "record a promise to pay");

    const body = await request.json();
    const parsed = createPromiseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }

    const promise = await createPromise(ctx.organizationId, ctx.userId, parsed.data);
    return NextResponse.json({ id: promise.id }, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    // The refusals this can raise are all things the person needs to read —
    // an existing open promise, a date in the past — so they come back as the
    // sentence itself rather than as a code.
    const expected =
      /already has an open promise|cannot be dated in the past|more than a year|not found/i.test(
        message,
      );
    if (!expected) console.error("[promises] create failed:", err);
    return NextResponse.json({ error: message }, { status: expected ? 409 : 500 });
  }
}
