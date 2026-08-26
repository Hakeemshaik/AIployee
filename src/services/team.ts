import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ROLES, type Role } from "@/lib/auth";
import { hashPassword, passwordProblem } from "@/lib/password";

// ---------------------------------------------------------------------------
// Team management.
//
// The deployment has no outbound email, so joining works by link: an admin
// creates an invite, the app shows the link exactly once, the admin sends it
// themselves, and the invitee sets their own password on that link. Tokens are
// stored as SHA-256 only — reading the database cannot mint a working link —
// and expire after seven days, single use.
//
// Two rules protect the organization itself:
//  * The last admin can neither be removed nor demoted; a lockout is not a
//    valid state to reach through the UI.
//  * Every mutation here is audited with the acting user.
// ---------------------------------------------------------------------------

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class TeamError extends Error {
  constructor(
    message: string,
    readonly code:
      | "email_taken"
      | "invite_invalid"
      | "invite_expired"
      | "last_admin"
      | "not_found"
      | "weak_password"
      | "invalid_role",
  ) {
    super(message);
    this.name = "TeamError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertRole(role: string): asserts role is Role {
  if (!ROLES.includes(role as Role)) {
    throw new TeamError(`"${role}" is not a valid role.`, "invalid_role");
  }
}

export async function listTeam(organizationId: string) {
  const [users, invites] = await Promise.all([
    db.user.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, createdAt: true, passwordHash: true },
    }),
    db.invite.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);
  return {
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      canSignIn: !!user.passwordHash,
    })),
    invites,
  };
}

/** Create an invite and return the one-time link token (shown once, never stored). */
export async function createInvite(
  organizationId: string,
  actorId: string,
  input: { email: string; name: string; role: string },
): Promise<{ inviteId: string; token: string; expiresAt: Date }> {
  assertRole(input.role);
  const email = input.email.trim().toLowerCase();

  // User.email is globally unique, so a taken address cannot be invited.
  const existing = await db.user.findFirst({ where: { email }, select: { id: true } });
  if (existing) {
    throw new TeamError("A user with that email already exists.", "email_taken");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // One live invite per address: re-inviting replaces the outstanding link.
  await db.invite.deleteMany({ where: { organizationId, email, acceptedAt: null } });
  const invite = await db.invite.create({
    data: {
      organizationId,
      email,
      name: input.name.trim(),
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt,
      createdById: actorId,
    },
  });

  await audit({
    organizationId,
    actorType: "user",
    actorId,
    action: "team.invite_created",
    entityType: "invite",
    entityId: invite.id,
    detail: { email, role: input.role },
  });

  return { inviteId: invite.id, token, expiresAt };
}

export async function revokeInvite(organizationId: string, actorId: string, inviteId: string) {
  const invite = await db.invite.findFirst({ where: { id: inviteId, organizationId } });
  if (!invite) throw new TeamError("That invite no longer exists.", "not_found");
  await db.invite.delete({ where: { id: invite.id } });
  await audit({
    organizationId,
    actorType: "user",
    actorId,
    action: "team.invite_revoked",
    entityType: "invite",
    entityId: invite.id,
    detail: { email: invite.email },
  });
}

/** What an invite link is for, shown on the accept page. Token never returned. */
export async function inspectInvite(token: string) {
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!invite || invite.acceptedAt) {
    throw new TeamError("This invite link is not valid.", "invite_invalid");
  }
  if (invite.expiresAt < new Date()) {
    throw new TeamError("This invite link has expired — ask for a new one.", "invite_expired");
  }
  return {
    organizationName: invite.organization.name,
    email: invite.email,
    name: invite.name,
    role: invite.role,
  };
}

/** Accept an invite: create the user with their chosen password. */
export async function acceptInvite(token: string, password: string): Promise<{ userId: string }> {
  const problem = passwordProblem(password);
  if (problem) throw new TeamError(problem, "weak_password");

  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.acceptedAt) {
    throw new TeamError("This invite link is not valid.", "invite_invalid");
  }
  if (invite.expiresAt < new Date()) {
    throw new TeamError("This invite link has expired — ask for a new one.", "invite_expired");
  }
  // The address could have been claimed between invite and accept.
  const taken = await db.user.findFirst({ where: { email: invite.email }, select: { id: true } });
  if (taken) throw new TeamError("A user with that email already exists.", "email_taken");

  const user = await db.user.create({
    data: {
      organizationId: invite.organizationId,
      name: invite.name,
      email: invite.email,
      role: invite.role,
      passwordHash: await hashPassword(password),
    },
  });
  await db.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
  await audit({
    organizationId: invite.organizationId,
    actorType: "user",
    actorId: user.id,
    action: "team.invite_accepted",
    entityType: "user",
    entityId: user.id,
    detail: { email: user.email, role: user.role },
  });
  return { userId: user.id };
}

async function assertNotLastAdmin(organizationId: string, userId: string) {
  const target = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!target) throw new TeamError("That user no longer exists.", "not_found");
  if (target.role === "admin") {
    const admins = await db.user.count({ where: { organizationId, role: "admin" } });
    if (admins <= 1) {
      throw new TeamError(
        "This is the organization's only admin — promote someone else first.",
        "last_admin",
      );
    }
  }
  return target;
}

export async function changeRole(
  organizationId: string,
  actorId: string,
  userId: string,
  role: string,
) {
  assertRole(role);
  const target = await assertNotLastAdmin(organizationId, userId);
  if (target.role === role) return;
  await db.user.update({ where: { id: target.id }, data: { role } });
  await audit({
    organizationId,
    actorType: "user",
    actorId,
    action: "team.role_changed",
    entityType: "user",
    entityId: target.id,
    detail: { from: target.role, to: role },
  });
}

export async function removeUser(organizationId: string, actorId: string, userId: string) {
  if (userId === actorId) {
    throw new TeamError("You cannot remove your own account.", "last_admin");
  }
  const target = await assertNotLastAdmin(organizationId, userId);
  await db.user.delete({ where: { id: target.id } });
  await audit({
    organizationId,
    actorType: "user",
    actorId,
    action: "team.user_removed",
    entityType: "user",
    entityId: target.id,
    detail: { email: target.email, role: target.role },
  });
}
