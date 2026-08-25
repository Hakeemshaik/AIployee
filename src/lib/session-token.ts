import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Session token: a signed, self-contained cookie value.
//
// Format is `<base64url payload>.<hex hmac>`. The payload is readable by the
// holder, which is fine — it carries a user id and an expiry, no secrets — but
// it cannot be altered without the server's key, so a visitor cannot promote a
// guest session to a real one or extend their own expiry.
//
// Kept free of next/headers and the database so it can be tested directly.
// ---------------------------------------------------------------------------

export type Session =
  | { kind: "guest"; expiresAt: number }
  | { kind: "user"; userId: string; expiresAt: number };

export const GUEST_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const USER_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function encodeSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Decode and verify a token. Returns null for anything untrustworthy — a bad
 * signature, a malformed payload, an unknown kind, or an expired session — so
 * callers have one thing to check.
 */
export function decodeSession(token: string | undefined | null, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Compare before parsing: an unsigned payload is never worth reading.
  const expected = sign(payload, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  const expiresAt = candidate.expiresAt;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) return null;

  if (candidate.kind === "guest") return { kind: "guest", expiresAt };
  if (candidate.kind === "user" && typeof candidate.userId === "string" && candidate.userId.length > 0) {
    return { kind: "user", userId: candidate.userId, expiresAt };
  }
  return null;
}
