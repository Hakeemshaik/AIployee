import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  decodeSession,
  encodeSession,
  GUEST_TTL_MS,
  USER_TTL_MS,
  type Session,
} from "./session-token";

// ---------------------------------------------------------------------------
// Sessions.
//
// One signed httpOnly cookie carries either a demo (guest) session or a real
// user session. The client cannot read it, cannot forge one, and cannot promote
// a guest session into a user session — the signature covers the whole payload,
// and every privileged path re-checks server-side rather than trusting the UI.
//
// A guest sees fixture data only. That is enforced in getContext(), not here:
// any page that resolves a real organization refuses a guest session outright.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "aip_session";
const SECRET_NAME = "session_signing_key";

let cachedSecret: string | null = null;

/**
 * The key the session cookie is signed with.
 *
 * AUTH_SECRET when configured. Otherwise one is generated and stored once, so a
 * deployment that never set the variable still holds sessions — the
 * alternatives are a constant key (forgeable by anyone reading the source) or
 * refusing to run (locking the owner out of their own deployment).
 */
export async function sessionSecret(): Promise<string> {
  const configured = process.env.AUTH_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (cachedSecret) return cachedSecret;

  const existing = await db.serverSecret.findUnique({ where: { name: SECRET_NAME } });
  if (existing) {
    cachedSecret = existing.value;
    return existing.value;
  }
  const generated = randomBytes(32).toString("base64url");
  try {
    const created = await db.serverSecret.create({ data: { name: SECRET_NAME, value: generated } });
    cachedSecret = created.value;
    return created.value;
  } catch {
    // Another instance created it first — read theirs, so both sign alike.
    const raced = await db.serverSecret.findUnique({ where: { name: SECRET_NAME } });
    if (!raced) throw new Error("Could not establish a session signing key.");
    cachedSecret = raced.value;
    return raced.value;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return decodeSession(token, await sessionSecret());
  } catch {
    // The signing key is unavailable (database down) — no session is provable,
    // so nobody is signed in. Failing closed is the only safe direction.
    return null;
  }
}

async function write(session: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(session, await sessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(session.expiresAt),
  });
}

export async function startGuestSession(): Promise<void> {
  await write({ kind: "guest", expiresAt: Date.now() + GUEST_TTL_MS });
}

export async function startUserSession(userId: string): Promise<void> {
  await write({ kind: "user", userId, expiresAt: Date.now() + USER_TTL_MS });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function isGuest(): Promise<boolean> {
  return (await getSession())?.kind === "guest";
}

export class GuestBlockedError extends Error {
  // The action is named so the message fits whatever was refused — the guard
  // covers ingestion as well as calling.
  constructor(action = "trigger calls") {
    super(`Not available in the demo — sign in to ${action}.`);
    this.name = "GuestBlockedError";
  }
}

/** Guard for any action a guest must never perform. */
export async function blockGuests(action?: string): Promise<void> {
  if (await isGuest()) throw new GuestBlockedError(action);
}

export type { Session };
