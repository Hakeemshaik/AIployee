import { NextResponse } from "next/server";
import { z } from "zod";
import { endSession, getSession, startGuestSession, startUserSession } from "@/lib/session";
import {
  claimDeployment,
  claimState,
  SIGN_IN_FAILURE_MESSAGE,
  signIn,
} from "@/services/auth";

// POST /api/session — start or end a session.
//
// Four modes: guest (demo fixtures), signin (credentials), claim (set the first
// password on a deployment that has none), signout. Credentials are read here
// and never echoed back.

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("guest") }),
  z.object({ mode: z.literal("signout") }),
  z.object({
    mode: z.literal("signin"),
    email: z.string().min(3).max(320),
    password: z.string().min(1).max(200),
  }),
  z.object({
    mode: z.literal("claim"),
    email: z.string().min(3).max(320),
    password: z.string().min(1).max(200),
    name: z.string().max(120).optional(),
  }),
]);

/** Best-effort caller identity for rate limiting. */
function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// GET /api/session — who am I, and does this deployment still need a password?
export async function GET() {
  try {
    const session = await getSession();
    const claim = await claimState();
    return NextResponse.json({
      session: session ? { kind: session.kind, expiresAt: session.expiresAt } : null,
      unclaimed: claim.unclaimed,
      suggestedEmail: claim.suggestedEmail,
      organizationName: claim.organizationName,
    });
  } catch {
    // The database is unreachable; report no session rather than a broken page.
    return NextResponse.json({ session: null, unclaimed: false, suggestedEmail: null });
  }
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }
  const body = parsed.data;

  try {
    if (body.mode === "signout") {
      await endSession();
      return NextResponse.json({ mode: "signout" });
    }

    if (body.mode === "guest") {
      await startGuestSession();
      return NextResponse.json({ mode: "guest", redirectTo: "/analytics" });
    }

    if (body.mode === "claim") {
      const result = await claimDeployment(body.email, body.password, body.name);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.reason, message: result.message },
          { status: result.reason === "closed" ? 409 : 422 },
        );
      }
      await startUserSession(result.userId);
      return NextResponse.json({ mode: "claim", redirectTo: "/", created: result.created });
    }

    const result = await signIn(body.email, body.password, callerKey(request));
    if (!result.ok) {
      if (result.reason === "rate_limited") {
        return NextResponse.json(
          {
            error: "rate_limited",
            message: `Too many attempts. Try again in ${result.retryAfterSeconds ?? 60} seconds.`,
          },
          { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds ?? 60) } },
        );
      }
      // Uniform message: this must not reveal whether the account exists.
      return NextResponse.json(
        { error: "invalid_credentials", message: SIGN_IN_FAILURE_MESSAGE },
        { status: 401 },
      );
    }

    await startUserSession(result.userId);
    return NextResponse.json({ mode: "signin", redirectTo: "/" });
  } catch (err) {
    console.error("[session] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
