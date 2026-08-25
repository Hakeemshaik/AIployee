import { NextResponse } from "next/server";
import { z } from "zod";
import { getSetupStatus, runSetup, SetupLockedError, setupSchema } from "@/services/bootstrap";

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
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SetupLockedError) {
      return NextResponse.json({ error: "already_set_up", message: err.message }, { status: 403 });
    }
    console.error("[setup] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
