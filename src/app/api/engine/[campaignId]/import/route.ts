import { NextResponse } from "next/server";
import { z } from "zod";
import { engineContext, engineError } from "../../guard";
import { importIntoEngine } from "@/services/engine/import";
import { parseUploads, rowsFromPaste, rowsFromXlsx, type UploadInput } from "@/services/engine/parse-upload";

// POST /api/engine/<campaignId>/import — files and/or a paste become the book.
// Returns { needsMapping } with a preview when a layout cannot be detected,
// and accepts the hand-picked mapping on the retry.
export const maxDuration = 120;

const mappingSchema = z.object({
  fingerprint: z.string().min(4),
  mapping: z.object({
    tenant: z.coerce.number().int().min(0),
    bal: z.coerce.number().int().min(0),
    phone: z.coerce.number().int().min(0),
    unit: z.coerce.number().int().min(0),
    building: z.coerce.number().int().min(0),
    code: z.coerce.number().int().min(0).nullable(),
  }),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("import a book");
    const { campaignId } = await params;

    const form = await request.formData();
    const inputs: UploadInput[] = [];
    for (const entry of form.getAll("files")) {
      if (!(entry instanceof File)) continue;
      const buffer = Buffer.from(await entry.arrayBuffer());
      inputs.push({ name: entry.name, rows: rowsFromXlsx(buffer) });
    }
    const paste = String(form.get("paste") ?? "").trim();
    if (paste) inputs.push({ name: "pasted rows", rows: rowsFromPaste(paste) });
    if (inputs.length === 0) {
      return NextResponse.json(
        { error: "validation_failed", message: "Attach at least one file or paste rows." },
        { status: 422 },
      );
    }

    const manualRaw = form.get("manual");
    const manual = manualRaw ? mappingSchema.parse(JSON.parse(String(manualRaw))) : undefined;

    const parsed = await parseUploads(ctx.organizationId, inputs, manual);
    if (parsed.needsMapping) return NextResponse.json(parsed, { status: 200 });

    const summary = await importIntoEngine(ctx.organizationId, campaignId, ctx.userId, parsed.parsed);
    return NextResponse.json({ needsMapping: false, summary }, { status: 201 });
  } catch (err) {
    return engineError(err);
  }
}
