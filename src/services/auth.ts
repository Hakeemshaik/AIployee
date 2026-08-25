import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";

// ---------------------------------------------------------------------------
// Credential sign-in.
//
// Two rules shape the responses here:
//
//  * Failures are indistinguishable. A wrong password, an unknown email and a
//    user who has never set a password all return the same message, so this
//    endpoint cannot be used to enumerate accounts.
//  * Attempts are rate limited per email and per caller, because a password
//    endpoint is the one place an attacker gets unlimited free guesses.
//
// A deployment can exist with users but no passwords — the seeded demo data
// creates users directly. Rather than leave those deployments unreachable, the
// first-run claim below lets an admin set the first password, and it closes
// permanently the moment any password exists.
// ---------------------------------------------------------------------------

export type SignInResult =
  | { ok: true; userId: string; userName: string; organizationName: string }
  | { ok: false; reason: "invalid" | "rate_limited"; retryAfterSeconds?: number };

const GENERIC_FAILURE = "Those details are not correct.";

export const SIGN_IN_FAILURE_MESSAGE = GENERIC_FAILURE;

export async function signIn(
  email: string,
  password: string,
  callerKey: string,
): Promise<SignInResult> {
  const normalisedEmail = email.trim().toLowerCase();

  // Two windows: one per account (stops a single account being ground down),
  // one per caller (stops one client spraying many accounts).
  const perAccount = checkRateLimit(`signin:email:${normalisedEmail}`, {
    limit: 8,
    windowMs: 10 * 60 * 1000,
  });
  const perCaller = checkRateLimit(`signin:caller:${callerKey}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!perAccount.allowed || !perCaller.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: Math.max(perAccount.retryAfterSeconds, perCaller.retryAfterSeconds),
    };
  }

  const user = await db.user.findFirst({
    where: { email: normalisedEmail },
    include: { organization: { select: { name: true } } },
  });

  // verifyPassword returns false for a null hash, and is still run against a
  // dummy hash when no user matched so the timing does not reveal existence.
  const stored = user?.passwordHash ?? null;
  const matches = await verifyPassword(password, stored ?? PLACEHOLDER_HASH);
  if (!user || !stored || !matches) {
    return { ok: false, reason: "invalid" };
  }

  await audit({
    organizationId: user.organizationId,
    actorType: "user",
    actorId: user.id,
    action: "user.signed_in",
    entityType: "user",
    entityId: user.id,
  });

  return {
    ok: true,
    userId: user.id,
    userName: user.name,
    organizationName: user.organization.name,
  };
}

/**
 * A real scrypt hash of a random value, compared against when no user matched.
 *
 * Without this, an unknown email returns before any hashing happens and a
 * known one does not — a timing difference that leaks which accounts exist.
 */
const PLACEHOLDER_HASH =
  "scrypt$16384$8$1$4f9c2b7d1e8a6350c4b9f2d7a1e83506$" +
  "3c8f1d5b9a2e7460f8c3b1d6a9e25740f1c8b3d6a9e2574018c3b6d9a2e5740f" +
  "1c8b3d6a9e2574018c3b6d9a2e5740f1c8b3d6a9e2574018c3b6d9a2e5740f18";

export type ClaimState = {
  /** True when the deployment has users but none can sign in yet. */
  unclaimed: boolean;
  /** An existing account address, offered only as a convenience. */
  suggestedEmail: string | null;
  organizationName: string | null;
};

/**
 * Whether this deployment still needs its first password.
 *
 * True only while an organization exists and NO user has a password. Once any
 * password is set the window is closed for good.
 */
export async function claimState(): Promise<ClaimState> {
  const [withPassword, org] = await Promise.all([
    db.user.count({ where: { NOT: { passwordHash: null } } }),
    db.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { name: true, users: { orderBy: { createdAt: "asc" }, take: 1, select: { email: true } } },
    }),
  ]);
  if (withPassword > 0 || !org || org.users.length === 0) {
    return { unclaimed: false, suggestedEmail: null, organizationName: null };
  }
  return {
    unclaimed: true,
    suggestedEmail: org.users[0].email,
    organizationName: org.name,
  };
}

export type ClaimResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: "closed" | "no_organization" | "weak_password"; message: string };

/**
 * Set the first password on a deployment that has none, and sign that person in.
 *
 * The email does NOT have to match an existing row. A seeded database is full of
 * fictional demo staff, and requiring one of those addresses would mean the
 * owner signs in as a made-up person — so an unrecognised email creates a real
 * admin account on the existing organization instead of refusing.
 */
export async function claimDeployment(
  email: string,
  password: string,
  name?: string,
): Promise<ClaimResult> {
  const state = await claimState();
  if (!state.unclaimed) {
    return {
      ok: false,
      reason: "closed",
      message: "This deployment already has a password set. Sign in instead.",
    };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, reason: "weak_password", message: problem };

  const organization = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!organization) {
    return {
      ok: false,
      reason: "no_organization",
      message: "This deployment has not been set up yet. Open /setup first.",
    };
  }

  const normalisedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const existing = await db.user.findFirst({ where: { email: normalisedEmail } });

  const user = existing
    ? await db.user.update({
        where: { id: existing.id },
        data: { passwordHash, role: "admin" },
      })
    : await db.user.create({
        data: {
          organizationId: organization.id,
          name: name?.trim() || deriveName(normalisedEmail),
          email: normalisedEmail,
          role: "admin",
          passwordHash,
        },
      });

  await audit({
    organizationId: user.organizationId,
    actorType: "user",
    actorId: user.id,
    action: "deployment.claimed",
    entityType: "user",
    entityId: user.id,
    detail: { email: user.email, createdAccount: !existing },
  });
  return { ok: true, userId: user.id, created: !existing };
}

/** A reasonable display name from an email, until the person edits it. */
function deriveName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return words.join(" ") || "Administrator";
}

/** Change a signed-in user's own password. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: "That user no longer exists." };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, message: "Your current password is not correct." };
  }
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, message: problem };
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await audit({
    organizationId: user.organizationId,
    actorType: "user",
    actorId: user.id,
    action: "user.password_changed",
    entityType: "user",
    entityId: user.id,
  });
  return { ok: true };
}
