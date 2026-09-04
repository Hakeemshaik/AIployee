import { engineContext, engineError } from "../../guard";
import { jobixImportWorkbook } from "@/services/engine/import-file";

// GET /api/engine/<campaignId>/import-file — the campaign's book as the
// 72-column Jobix import workbook, cleaned exactly as the engine dials it.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("export the import workbook");
    const { campaignId } = await params;
    const { buffer, filename } = await jobixImportWorkbook(ctx.organizationId, campaignId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return engineError(err);
  }
}
