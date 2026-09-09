import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext } from "@/lib/auth";
import { getDialAttempt } from "@/services/dial-attempts";

// GET /api/calling/one/<attemptId>
//
// What happened on one dial. The result panel polls this while a call is open;
// scoped to the caller's organization, so an attempt id from elsewhere returns
// nothing rather than somebody else's transcript.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await apiContext();
    const attempt = await getDialAttempt(ctx.organizationId, id);
    if (!attempt) {
      return NextResponse.json({ error: "not_found", message: "No such dial." }, { status: 404 });
    }
    return NextResponse.json(attempt);
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[calling/one] read failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
