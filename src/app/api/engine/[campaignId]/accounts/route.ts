import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../guard";
import { listEngineAccounts } from "@/services/engine/state";

// GET /api/engine/<campaignId>/accounts?list=…|state=…|round=… — the accounts
// behind a number on the screen, with what the tenant actually said.
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("view engine accounts");
    const { campaignId } = await params;
    const url = new URL(request.url);
    const rows = await listEngineAccounts(ctx.organizationId, campaignId, {
      list: url.searchParams.get("list") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      round: url.searchParams.get("round") ? Number(url.searchParams.get("round")) : undefined,
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return engineError(err);
  }
}
