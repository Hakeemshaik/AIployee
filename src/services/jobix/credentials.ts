import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { open, seal } from "@/lib/secret-box";
import { JobixError, loadJobixEnv } from "./client";

// ---------------------------------------------------------------------------
// The Jobix sign-in, held by the platform rather than by an environment
// variable.
//
// Why this exists: the dashboard API only accepts tokens minted by a login, and
// those last an hour, so the platform has to be able to log in again on its
// own. When the only source of that credential is an environment variable,
// every way an environment variable can go wrong — saved to the wrong
// environment, pasted without its value, added after the build, quote-wrapped,
// truncated — silently stops the platform dialling. That has happened
// repeatedly on this deployment.
//
// So an admin signs in once inside the app. The credential is VERIFIED by
// actually logging in before it is stored, encrypted at rest, and used from
// then on. Environment variables still work and are the fallback, so nothing
// that already works stops working.
//
// The password is never returned to any caller but the login path, never sent
// to the browser, and never written to the audit log — only the email is,
// because knowing which account started dialling is the point of the log.
// ---------------------------------------------------------------------------

const STORE_NAME = "jobix_sign_in";
/** Cleared whenever the stored credential changes, so a stale session dies. */
const TOKEN_CACHE = "jobix_session_token";

export type StoredSignIn = { email: string; password: string };

type Envelope = { email: string; password: string; savedAt: string; savedBy: string };

export type SignInStatus = {
  /** A credential is stored here and readable. */
  stored: boolean;
  email: string | null;
  savedAt: string | null;
  /** A credential is present in the environment as well. */
  environment: boolean;
  /** Which one the platform will actually use. */
  using: "stored" | "environment" | "none";
};

export async function signInStatus(): Promise<SignInStatus> {
  const env = loadJobixEnv();
  const environment = !!(env?.email && env?.password);
  const row = await db.serverSecret.findUnique({ where: { name: STORE_NAME } });
  const envelope = row ? await readEnvelope(row.value) : null;

  return {
    stored: !!envelope,
    email: envelope?.email ?? null,
    savedAt: envelope?.savedAt ?? null,
    environment,
    using: envelope ? "stored" : environment ? "environment" : "none",
  };
}

async function readEnvelope(sealed: string): Promise<Envelope | null> {
  const plain = await open(sealed);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as Envelope;
    return parsed.email && parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

/** The stored credential, or null. Used only by the login path. */
export async function storedSignIn(): Promise<StoredSignIn | null> {
  const row = await db.serverSecret.findUnique({ where: { name: STORE_NAME } });
  if (!row) return null;
  const envelope = await readEnvelope(row.value);
  return envelope ? { email: envelope.email, password: envelope.password } : null;
}

/**
 * Verify a sign-in against Jobix, then store it.
 *
 * The order is the point: a credential that does not work is never written, so
 * "saved" always means "this signs in". Anything else would move the failure
 * from a form the admin is looking at to a dialling run nobody is watching.
 */
export async function saveSignIn(
  organizationId: string,
  userId: string,
  email: string,
  password: string,
): Promise<SignInStatus> {
  const env = loadJobixEnv();
  const base = env?.base ?? (process.env.JOBIX_BASE ?? "https://dashboard.jobix.ai").replace(/\/$/, "");

  const { signInWith } = await import("./auth");
  await signInWith(base, email.trim(), password);

  const envelope: Envelope = {
    email: email.trim(),
    password,
    savedAt: new Date().toISOString(),
    savedBy: userId,
  };
  const value = await seal(JSON.stringify(envelope));
  await db.serverSecret.upsert({
    where: { name: STORE_NAME },
    create: { name: STORE_NAME, value },
    update: { value },
  });
  // A cached token belongs to the credential that minted it.
  await db.serverSecret.deleteMany({ where: { name: TOKEN_CACHE } });

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.sign_in_saved",
    entityType: "integration_settings",
    entityId: organizationId,
    // The account, never the password.
    detail: { email: envelope.email },
  });

  return signInStatus();
}

export async function clearSignIn(organizationId: string, userId: string): Promise<SignInStatus> {
  await db.serverSecret.deleteMany({ where: { name: STORE_NAME } });
  await db.serverSecret.deleteMany({ where: { name: TOKEN_CACHE } });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "jobix.sign_in_cleared",
    entityType: "integration_settings",
    entityId: organizationId,
  });
  const status = await signInStatus();
  if (status.using === "none") {
    throw new JobixError(
      "The stored sign-in was removed, and there is none in the environment either — the platform can no longer read Jobix.",
      "not_configured",
    );
  }
  return status;
}
