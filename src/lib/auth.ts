import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Authentication context — auth-ready stub.
//
// The platform is built for session-based auth (NextAuth / Lucia / a JWT in an
// httpOnly cookie). Every service call takes an explicit organizationId that
// originates HERE and nowhere else, so wiring in real auth later is a change
// to this one file: resolve the session, look up the user's organization, and
// the rest of the app is already tenant-isolated.
//
// In the demo build we resolve the seeded demo organization.
// ---------------------------------------------------------------------------

export type AppContext = {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  userRole: string;
};

export const getContext = cache(async (): Promise<AppContext> => {
  // TODO(auth): replace with real session resolution.
  const org = await db.organization.findFirst({
    orderBy: { createdAt: "asc" },
    include: { users: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!org || org.users.length === 0) {
    // Fresh deployment — send the visitor to the one-time setup flow.
    redirect("/setup");
  }
  const user = org.users[0];
  return {
    organizationId: org.id,
    organizationName: org.name,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
  };
});

// ---------------------------------------------------------------------------
// Authorization.
//
// Role gate for privileged actions (starting/stopping campaigns, redialling,
// viewing transcripts and recordings). Throws so route handlers can map it to
// a 403 uniformly. Wired to the same context object real auth will populate.
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "manager", "collector", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export class NotPermittedError extends Error {
  constructor(action: string, role: string) {
    super(`Your role (${role}) is not permitted to ${action}.`);
    this.name = "NotPermittedError";
  }
}

export function requireRole(ctx: AppContext, allowed: readonly Role[], action: string): void {
  if (!allowed.includes(ctx.userRole as Role)) {
    throw new NotPermittedError(action, ctx.userRole);
  }
}

/** Non-throwing check, for hiding controls the user cannot use. */
export function hasRole(ctx: AppContext, allowed: readonly Role[]): boolean {
  return allowed.includes(ctx.userRole as Role);
}
