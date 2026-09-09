import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure, jobixFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { testConnection } from "@/services/connection-status";

// POST /api/settings/connection — sign in to the voice platform and report
// what came back. Admin only: it names the workspace's agents.
export const maxDuration = 60;

const signInSchema = z.object({
  action: z.literal("sign_in"),
  email: z.string().email().max(200),
  password: z.string().min(1).max(400),
});
const clearSchema = z.object({ action: z.literal("clear_sign_in") });
const keySchema = z.object({
  action: z.literal("company_key"),
  companyKey: z.string().min(1).max(400),
});
const clearKeySchema = z.object({ action: z.literal("clear_company_key") });
const probeSchema = z.object({
  action: z.literal("probe_write"),
  phone: z.string().max(30).optional(),
});

export async function POST(request: Request) {
  try {
    await blockGuests("test the voice platform connection");
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "test the voice platform connection");

    // A body is optional: no body still means "test the connection".
    const body = await request.json().catch(() => ({}));

    const signIn = signInSchema.safeParse(body);
    if (signIn.success) {
      const { saveSignIn } = await import("@/services/jobix/credentials");
      try {
        // Verified against Jobix before it is stored, so a failure here never
        // leaves a broken credential behind.
        return NextResponse.json(
          await saveSignIn(ctx.organizationId, ctx.userId, signIn.data.email, signIn.data.password),
        );
      } catch (err) {
        // A credential someone just typed being refused is an answer about
        // what they typed. 502 would blame this server's upstream for it.
        const { JobixError } = await import("@/services/jobix/client");
        if (err instanceof JobixError && err.code === "unauthorized") {
          return NextResponse.json(
            { error: "unauthorized", message: err.message },
            { status: 400 },
          );
        }
        throw err;
      }
    }
    const probe = probeSchema.safeParse(body);
    if (probe.success) {
      const { probeWrite } = await import("@/services/jobix/push");
      return NextResponse.json(
        await probeWrite(ctx.organizationId, ctx.userId, { phone: probe.data.phone }),
      );
    }
    const key = keySchema.safeParse(body);
    if (key.success) {
      const { saveCompanyKey } = await import("@/services/jobix/credentials");
      return NextResponse.json(
        await saveCompanyKey(ctx.organizationId, ctx.userId, key.data.companyKey),
      );
    }
    if (clearKeySchema.safeParse(body).success) {
      const { clearCompanyKey } = await import("@/services/jobix/credentials");
      return NextResponse.json(await clearCompanyKey(ctx.organizationId, ctx.userId));
    }
    if (clearSchema.safeParse(body).success) {
      const { clearSignIn } = await import("@/services/jobix/credentials");
      return NextResponse.json(await clearSignIn(ctx.organizationId, ctx.userId));
    }

    return NextResponse.json(await testConnection());
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    // A rejected sign-in is an answer to the form, not a server fault.
    const jobix = jobixFailure(err);
    if (jobix) return jobix;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[settings/connection] failed:", err);
    return NextResponse.json({ error: message, message }, { status: 500 });
  }
}
