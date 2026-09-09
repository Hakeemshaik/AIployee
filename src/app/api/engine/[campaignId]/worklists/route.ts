import { engineContext, engineError } from "../../guard";
import { worklistsWorkbook } from "@/services/engine/export";

// GET /api/engine/<campaignId>/worklists — the .xlsx, refused if it does not
// reconcile to the campaign totals.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("export worklists");
    const { campaignId } = await params;
    const { buffer } = await worklistsWorkbook(ctx.organizationId, campaignId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="worklists.xlsx"',
      },
    });
  } catch (err) {
    return engineError(err);
  }
}
