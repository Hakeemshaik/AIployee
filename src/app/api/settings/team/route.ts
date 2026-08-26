import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole, ROLES } from "@/lib/auth";
import {
  changeRole,
  createInvite,
  listTeam,
  removeUser,
  revokeInvite,
  TeamError,
} from "@/services/team";

function teamFailure(err: unknown): NextResponse | null {
  if (!(err instanceof TeamError)) return null;
  const status =
    err.code === "not_found" ? 404 : err.code === "email_taken" || err.code === "last_admin" ? 409 : 422;
  return NextResponse.json({ error: err.code, message: err.message }, { status });
}

// GET /api/settings/team — members and outstanding invites.
export async function GET() {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "manage the team");
    return NextResponse.json(await listTeam(ctx.organizationId));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[settings/team] list failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    email: z.string().email().max(320),
    name: z.string().min(2).max(120),
    role: z.enum(ROLES),
  }),
  z.object({ action: z.literal("revoke_invite"), inviteId: z.string().min(1) }),
  z.object({ action: z.literal("change_role"), userId: z.string().min(1), role: z.enum(ROLES) }),
  z.object({ action: z.literal("remove_user"), userId: z.string().min(1) }),
]);

// POST /api/settings/team — invite, revoke, change role, remove. Admin only.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "manage the team");

    const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }
    const body = parsed.data;

    if (body.action === "invite") {
      const invite = await createInvite(ctx.organizationId, ctx.userId, body);
      // The token appears here once and is never retrievable again.
      return NextResponse.json(
        { inviteId: invite.inviteId, token: invite.token, expiresAt: invite.expiresAt },
        { status: 201 },
      );
    }
    if (body.action === "revoke_invite") {
      await revokeInvite(ctx.organizationId, ctx.userId, body.inviteId);
      return NextResponse.json({ revoked: true });
    }
    if (body.action === "change_role") {
      await changeRole(ctx.organizationId, ctx.userId, body.userId, body.role);
      return NextResponse.json({ changed: true });
    }
    await removeUser(ctx.organizationId, ctx.userId, body.userId);
    return NextResponse.json({ removed: true });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const team = teamFailure(err);
    if (team) return team;
    console.error("[settings/team] action failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
