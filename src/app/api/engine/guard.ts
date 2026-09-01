import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole, type AppContext } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { EngineGuardError } from "@/services/engine/dial";
import { JobixError } from "@/services/jobix/client";

/** Session + role gate shared by every engine route. */
export async function engineContext(action: string): Promise<AppContext> {
  await blockGuests(action);
  const ctx = await apiContext();
  requireRole(ctx, ["admin", "manager"], action);
  return ctx;
}

/**
 * Engine errors are sentences written for the operator — guard refusals, lock
 * violations, window closures — and they come back as 409 with the sentence,
 * never as a stack trace.
 */
export function engineError(err: unknown): NextResponse {
  const denied = authFailure(err);
  if (denied) return denied;
  if (err instanceof GuestBlockedError) {
    return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
  }
  if (err instanceof EngineGuardError || err instanceof JobixError) {
    return NextResponse.json({ error: "refused", message: err.message }, { status: 409 });
  }
  if (err instanceof Error && /cannot|refus|already|not found|blocking|must|window|Nobody|last automated/i.test(err.message)) {
    return NextResponse.json({ error: "refused", message: err.message }, { status: 409 });
  }
  console.error("[engine] failed:", err);
  return NextResponse.json({ error: "internal_error", message: "Something went wrong on the server." }, { status: 500 });
}
