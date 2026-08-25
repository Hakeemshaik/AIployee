import { NextResponse } from "next/server";
import { z } from "zod";
import { setGuest } from "@/lib/session";

const schema = z.object({ mode: z.enum(["guest", "signout"]) });

// POST /api/session — enter or leave the read-only demo session.
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }
  await setGuest(parsed.data.mode === "guest");
  return NextResponse.json({ mode: parsed.data.mode });
}
