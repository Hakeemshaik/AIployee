import { db } from "@/lib/db";
import { JobixError, redact } from "./client";

// ---------------------------------------------------------------------------
// Session authentication against the Jobix dashboard.
//
// Established empirically (profile "API key" tested against every plausible
// header/host combination — all rejected): the dashboard's /api/* endpoints
// accept ONLY the short-lived session tokens a browser gets by logging in.
// So the platform logs in the same way, captured from the real login flow:
//
//   POST {base}/api/auth/login
//   body: { "email": "...", "password": "...", "reCaptcha": "" }
//   tokens: Set-Cookie access_token=<jwt> (≈1h) — some responses may also
//   carry them in the JSON body, so both places are read.
//
// The access token is cached in ServerSecret so concurrent serverless
// invocations share one session instead of hammering the login endpoint, and
// re-minted when within a minute of expiry. There is no refresh-token dance:
// re-logging in hourly is simpler and survives refresh-token rotation.
// ---------------------------------------------------------------------------

const CACHE_NAME = "jobix_session_token";
/** Re-login this long before the token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;
const LOGIN_TIMEOUT_MS = 20_000;

let memoryToken: { token: string; expiresAt: number } | null = null;

/** Expiry (ms epoch) from a JWT's payload, or null when unreadable. */
export function jwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/**
 * Pull the access token out of a login response — JSON body first
 * (several key spellings), then Set-Cookie.
 */
export function extractAccessToken(body: unknown, setCookie: string[]): string | null {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const nested = (record.data ?? record.tokens ?? {}) as Record<string, unknown>;
    for (const candidate of [
      record.access_token,
      record.accessToken,
      record.token,
      nested.access_token,
      nested.accessToken,
      nested.token,
    ]) {
      if (typeof candidate === "string" && candidate.split(".").length === 3) return candidate;
    }
  }
  for (const header of setCookie) {
    const match = /(?:^|,\s*)access_token=([^;,\s]+)/.exec(header) ?? /access_token=([^;]+)/.exec(header);
    if (match?.[1] && match[1].split(".").length === 3) return match[1];
  }
  return null;
}

/**
 * Log in and return the access token, with no caching and no storage.
 *
 * Exported so a credential can be PROVED before it is saved: "saved" then
 * always means "this signs in", instead of moving the failure to a dialling
 * run nobody is watching.
 */
export async function signInWith(base: string, email: string, password: string): Promise<string> {
  return login(base, email, password);
}

async function login(base: string, email: string, password: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // reCaptcha is sent empty exactly as the dashboard's own login does.
      body: JSON.stringify({ email, password, reCaptcha: "" }),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      // Deliberately does not name an environment variable: the same login
      // serves a credential typed into Settings, and telling someone to check
      // a variable they never set sends them to the wrong place.
      throw new JobixError(
        "Jobix rejected the sign-in — the email or password is wrong.",
        "unauthorized",
        redact(text),
      );
    }
    if (!response.ok) {
      throw new JobixError(
        `Jobix sign-in failed (HTTP ${response.status}).`,
        "rejected",
        redact(text),
      );
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Tokens may still be in Set-Cookie.
    }
    const token = extractAccessToken(body, response.headers.getSetCookie?.() ?? []);
    if (!token) {
      throw new JobixError(
        "Jobix sign-in succeeded but no access token was found in the response.",
        "rejected",
      );
    }
    return token;
  } catch (err) {
    if (err instanceof JobixError) throw err;
    throw new JobixError("Jobix sign-in endpoint is unreachable.", "unavailable", redact(String(err)));
  } finally {
    clearTimeout(timer);
  }
}

function usable(entry: { token: string; expiresAt: number } | null): entry is {
  token: string;
  expiresAt: number;
} {
  return !!entry && entry.expiresAt - EXPIRY_MARGIN_MS > Date.now();
}

/**
 * A valid session token: memory cache → shared DB cache → fresh login.
 * `force` skips the caches — used after a 401 to re-mint immediately.
 */
export async function getSessionToken(
  base: string,
  email: string,
  password: string,
  options: { force?: boolean } = {},
): Promise<string> {
  if (!options.force) {
    if (usable(memoryToken)) return memoryToken.token;
    try {
      const stored = await db.serverSecret.findUnique({ where: { name: CACHE_NAME } });
      if (stored) {
        const parsed = JSON.parse(stored.value) as { token: string; expiresAt: number };
        if (usable(parsed)) {
          memoryToken = parsed;
          return parsed.token;
        }
      }
    } catch {
      // A broken cache row is re-minted below, not fatal.
    }
  }

  const token = await login(base, email, password);
  const expiresAt = jwtExpiryMs(token) ?? Date.now() + 45 * 60_000;
  memoryToken = { token, expiresAt };
  const value = JSON.stringify(memoryToken);
  await db.serverSecret
    .upsert({ where: { name: CACHE_NAME }, create: { name: CACHE_NAME, value }, update: { value } })
    .catch(() => {
      // Cache write failure costs a re-login later, nothing else.
    });
  return token;
}
