import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { recordPayment, recordPaymentSchema } from "@/services/payments";

// POST /api/payments — record a payment (drives promise resolution + events).
export async function POST(request: Request) {
  try {
    const ctx = await getContext();
    const body = await request.json();
    const parsed = recordPaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const payment = await recordPayment(
      ctx.organizationId,
      { type: "user", id: ctx.userId },
      parsed.data,
    );
    return NextResponse.json({ id: payment.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[payments] recording failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
