import { NextResponse } from "next/server";
import { NotAuthenticatedError, NotPermittedError } from "@/lib/auth";
import { GuestBlockedError } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";

/**
 * Map an authentication or authorization failure to a response.
 *
 * Returns null when the error is something else, so a route's own handling
 * still runs. Every API route calls this first in its catch block: without it a
 * caller with no session receives a 500 naming Next's internal redirect error.
 */
export function authFailure(err: unknown): NextResponse | null {
  if (err instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "not_authenticated", message: err.message }, { status: 401 });
  }
  if (err instanceof GuestBlockedError) {
    return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
  }
  if (err instanceof NotPermittedError) {
    return NextResponse.json({ error: "not_permitted", message: err.message }, { status: 403 });
  }
  return null;
}

/**
 * Map a voice-platform failure to a response.
 *
 * Shared because these are not internal errors and must not be logged or
 * answered as such: "paste the list first" and "calling is disabled on this
 * deployment" are answers, and a 500 with a stack trace buries them.
 */
export function jobixFailure(err: unknown): NextResponse | null {
  if (!(err instanceof JobixError)) return null;
  const status =
    err.code === "not_found" ? 404 : err.code === "not_configured" ? 501 : err.code === "rejected" ? 409 : 502;
  return NextResponse.json({ error: err.code, message: err.message }, { status });
}
