import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext } from "@/lib/auth";
import { csvToObjects } from "@/lib/csv";
import { importDebtors } from "@/services/debtors";

const bodySchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  campaignId: z.string().optional(),
});

// Normalized CSV header → import field.
const HEADER_MAP: Record<string, string> = {
  firstname: "firstName",
  lastname: "lastName",
  accountnumber: "accountNumber",
  account: "accountNumber",
  phone: "phone",
  phonenumber: "phone",
  email: "email",
  city: "city",
  province: "province",
  creditorname: "creditorName",
  creditor: "creditorName",
  originalbalance: "originalBalance",
  currentbalance: "currentBalance",
  balance: "currentBalance",
  duedate: "dueDate",
  daysoverdue: "daysOverdue",
};

// POST /api/debtors/import — CSV import with per-row validation results.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const objects = csvToObjects(parsed.data.csv);
    if (objects.length === 0) {
      return NextResponse.json(
        { error: "empty_csv", message: "The CSV needs a header row and at least one data row." },
        { status: 422 },
      );
    }
    if (objects.length > 5000) {
      return NextResponse.json(
        { error: "too_many_rows", message: "Import at most 5,000 rows per batch." },
        { status: 422 },
      );
    }
    const rows = objects.map((obj) => {
      const mapped: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj)) {
        const field = HEADER_MAP[key];
        if (field && value !== "") mapped[field] = value;
      }
      return mapped;
    });
    const result = await importDebtors(ctx.organizationId, ctx.userId, rows, parsed.data.campaignId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[debtors] import failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
