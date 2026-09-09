import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getSetupStatus,
  runSetup,
  SetupLockedError,
  setupSchema,
  WeakPasswordError,
} from "@/services/bootstrap";
import { startUserSession } from "@/lib/session";
import { db } from "@/lib/db";

// First-run bootstrap. Inert once an organization exists.

export async function GET() {
  try {
    const status = await getSetupStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error("[setup] status failed:", err);
    return NextResponse.json(
      { error: "database_unreachable", message: "Could not reach the database. Check DATABASE_URL." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const result = await runSetup(parsed.data);
    // Sign the new admin straight in — they just chose the password.
    const admin = await db.user.findFirst({
      where: { email: parsed.data.adminEmail.trim().toLowerCase() },
      select: { id: true },
    });
    if (admin) await startUserSession(admin.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof WeakPasswordError) {
      return NextResponse.json({ error: "weak_password", message: err.message }, { status: 422 });
    }
    if (err instanceof SetupLockedError) {
      return NextResponse.json({ error: "already_set_up", message: err.message }, { status: 403 });
    }
    console.error("[setup] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
