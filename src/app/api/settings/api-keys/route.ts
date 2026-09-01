import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";

// POST /api/settings/api-keys — mint the key the voice platform's webhook uses.
//
// Until now the only way to get one was a script run against the database,
// which on a hosted deployment means nobody gets one. The webhook cannot be
// configured without it, so this is the missing half of "point the flow's
// webhook here".
//
// The plaintext is returned exactly once and never stored — only its SHA-256
// hash is kept, which is also why there is no GET for it.

const schema = z.object({
  name: z.string().min(1).max(80).default("Jobix webhook"),
});

export async function POST(request: Request) {
  try {
    await blockGuests("create an API key");
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "create an API key");

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }

    const plaintext = `aip_live_${randomBytes(24).toString("base64url")}`;
    const key = await db.apiKey.create({
      data: {
        organizationId: ctx.organizationId,
        name: parsed.data.name,
        keyPrefix: plaintext.slice(0, 8),
        hashedKey: createHash("sha256").update(plaintext).digest("hex"),
        scopes: "voice:ingest",
      },
    });

    await audit({
      organizationId: ctx.organizationId,
      actorType: "user",
      actorId: ctx.userId,
      action: "api_key.created",
      entityType: "api_key",
      entityId: key.id,
      detail: { name: parsed.data.name, scopes: "voice:ingest" },
    });

    // The one and only time the plaintext leaves the server.
    return NextResponse.json({ id: key.id, key: plaintext }, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    console.error("[settings/api-keys] create failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
