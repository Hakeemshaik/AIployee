import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { dialOne } from "@/services/jobix/dial-one";

// One submit, one insert, one call — the form's own mechanism, on this
// platform. A single write with no read-back around it, so it finishes well
// inside a request.
export const maxDuration = 60;

const schema = z.union([
  z.object({ debtorId: z.string().min(1).max(80) }),
  z.object({
    name: z.string().min(1).max(120),
    phone: z.string().min(6).max(24),
    email: z.string().max(200).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    await blockGuests("place a call");
    const ctx = await apiContext();
    // Same authority as starting a run, because that is what this is: one call
    // to a real phone.
    requireRole(ctx, ["admin", "manager"], "place a call");

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid_request",
          message: "Send either an account id, or a name and a number to dial.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(await dialOne(ctx.organizationId, ctx.userId, parsed.data));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    // A closed calling window, a missing flag, a number that cannot be dialled:
    // all of them are the caller's to fix and none of them is a crash.
    if (err instanceof JobixError) {
      const status = err.code === "unauthorized" ? 502 : 400;
      return NextResponse.json({ error: err.code, message: err.message }, { status });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[calling/one] failed:", err);
    return NextResponse.json({ error: "internal_error", message }, { status: 500 });
  }
}
