import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { commitBook, parseSpreadsheet, previewBook } from "@/services/book-import";

// Book files parse in-memory; give the bigger ones headroom.
export const maxDuration = 120;

const MAX_FILE_BYTES = 4 * 1024 * 1024;

// POST /api/debtors/import-file — multipart upload of a book file.
// mode=preview validates and reports without writing; mode=commit imports.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "import debtors");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "validation_failed", message: "Attach a spreadsheet file (.xlsx or .csv)." },
        { status: 422 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", message: "Files up to 4 MB are supported. Split larger books." },
        { status: 413 },
      );
    }
    const mode = String(form.get("mode") ?? "preview");
    const campaignId = String(form.get("campaignId") ?? "") || undefined;

    let sheet;
    try {
      sheet = parseSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
    } catch (err) {
      return NextResponse.json(
        {
          error: "unreadable_file",
          message: err instanceof Error ? err.message : "The file could not be read as a spreadsheet.",
        },
        { status: 422 },
      );
    }

    if (mode === "commit") {
      const result = await commitBook(ctx.organizationId, ctx.userId, sheet, campaignId);
      return NextResponse.json(result, { status: 201 });
    }
    return NextResponse.json(await previewBook(ctx.organizationId, sheet));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const message = err instanceof Error ? err.message : "";
    if (message === "Campaign not found.") {
      return NextResponse.json({ error: "not_found", message }, { status: 404 });
    }
    console.error("[debtors/import-file] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
