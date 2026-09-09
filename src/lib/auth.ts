import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, GuestBlockedError } from "@/lib/session";

// ---------------------------------------------------------------------------
// Authentication context.
//
// Every organizationId in the application originates HERE and nowhere else, so
// this is the single place tenancy can be got wrong. It resolves the signed
// session cookie to a real user and organization, and refuses in three cases:
//
//  * No session — the visitor is sent to sign in. Before this existed, anyone
//    who reached the deployment was served the first organization in the
//    database as though they owned it.
//  * A demo (guest) session — sent to the analytics screen, which is the only
//    surface built on fixtures. Guests previously reached this function on
//    /debtors, /calls and /promises and were handed real debtor records; the
//    "no live accounts" promise held on one page out of twelve.
//  * A session naming a user who no longer exists — the cookie outlived the
//    account, so it is treated as no session at all.
// ---------------------------------------------------------------------------

export type AppContext = {
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  userRole: string;
};

/** Where a visitor with no usable session belongs. */
async function leave(): Promise<never> {
  // A database with no organization has never been set up; sending that visitor
  // to sign in would be a dead end.
  const organizations = await db.organization.count().catch(() => 1);
  redirect(organizations === 0 ? "/setup" : "/login");
}

export const getContext = cache(async (): Promise<AppContext> => {
  const session = await getSession();
  if (!session) return leave();
  if (session.kind === "guest") {
    // The demo has no organization of its own; fixtures live on /analytics.
    redirect("/analytics");
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!user) return leave();

  return {
    organizationId: user.organization.id,
    organizationName: user.organization.name,
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

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "NotAuthenticatedError";
  }
}

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

// ---------------------------------------------------------------------------
// Context for API route handlers.
//
// getContext() redirects, which is right for a page and wrong for an endpoint:
// a route handler that catches the redirect turns it into a 500 naming Next's
// internal error, and one that swallows it answers 200 with empty data. These
// throw instead, so a caller gets 401 or 403 and knows why.
// ---------------------------------------------------------------------------

export async function apiContext(): Promise<AppContext> {
  const session = await getSession();
  if (!session) throw new NotAuthenticatedError();
  if (session.kind === "guest") {
    throw new GuestBlockedError("use the live platform");
  }
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { organization: { select: { id: true, name: true } } },
  });
  if (!user) throw new NotAuthenticatedError();
  return {
    organizationId: user.organization.id,
    organizationName: user.organization.name,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
  };
}
