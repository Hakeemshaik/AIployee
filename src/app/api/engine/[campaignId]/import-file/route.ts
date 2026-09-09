import { engineContext, engineError } from "../../guard";
import { jobixImportWorkbook } from "@/services/engine/import-file";

// GET /api/engine/<campaignId>/import-file — the campaign's book as the
// 72-column Jobix import workbook, cleaned exactly as the engine dials it.
//
//   ?list=redial   only the accounts still owed a call
//   ?armed=1       fill the call column, so an upload rings those phones
//
// Every row carries a freshly minted suid either way: Jobix upserts on that
// value, and a known one uploads as an update that never dials.
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("export the import workbook");
    const { campaignId } = await params;
    const url = new URL(request.url);
    const { buffer, filename } = await jobixImportWorkbook(ctx.organizationId, campaignId, {
      list: url.searchParams.get("list") === "redial" ? "redial" : "book",
      armed: url.searchParams.get("armed") === "1",
    });
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
