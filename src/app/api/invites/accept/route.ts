import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { startUserSession } from "@/lib/session";
import { acceptInvite, inspectInvite, TeamError } from "@/services/team";

// Public endpoints: the invitee has no session yet. The token is the
// credential, so both endpoints are rate limited per caller.

function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : (request.headers.get("x-real-ip") ?? "unknown");
}

function teamFailure(err: unknown): NextResponse | null {
  if (!(err instanceof TeamError)) return null;
  const status = err.code === "weak_password" ? 422 : err.code === "email_taken" ? 409 : 404;
  return NextResponse.json({ error: err.code, message: err.message }, { status });
}

const inspectSchema = z.object({ token: z.string().min(20).max(200) });
const acceptSchema = inspectSchema.extend({ password: z.string().min(1).max(200) });

// POST /api/invites/accept — with only a token: describe the invite.
// With token and password: create the account and sign it in.
export async function POST(request: Request) {
  const limit = checkRateLimit(`invite:${callerKey(request)}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many attempts — try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const raw = await request.json().catch(() => ({}));
  try {
    const withPassword = acceptSchema.safeParse(raw);
    if (withPassword.success) {
      const { userId } = await acceptInvite(withPassword.data.token, withPassword.data.password);
      await startUserSession(userId);
      return NextResponse.json({ accepted: true, redirectTo: "/" });
    }
    const inspectOnly = inspectSchema.safeParse(raw);
    if (!inspectOnly.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }
    return NextResponse.json(await inspectInvite(inspectOnly.data.token));
  } catch (err) {
    const team = teamFailure(err);
    if (team) return team;
    console.error("[invites] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
