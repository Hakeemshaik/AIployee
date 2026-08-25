import { cache } from "react";
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
    throw new Error("No organization found — run `npm run db:seed` first.");
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
