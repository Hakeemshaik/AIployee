import { engineContext, engineError } from "../../guard";
import { buildCampaignReport } from "@/services/engine/complete";
import { reportDocx } from "@/services/engine/export";

// GET /api/engine/<campaignId>/report — the client-facing .docx.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("export the report");
    const { campaignId } = await params;
    const report = await buildCampaignReport(ctx.organizationId, campaignId);
    const buffer = await reportDocx(report);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="campaign-report.docx"',
      },
    });
  } catch (err) {
    return engineError(err);
  }
}
