import { createHash, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Inbound integration authentication.
//
// External systems (the voice platform) authenticate with per-organization
// API keys sent as `Authorization: Bearer <key>`. Only the SHA-256 hash of a
// key is stored; the org an authenticated request belongs to is derived from
// the key, never from the payload — which is what enforces tenant isolation
// at the integration boundary.
// ---------------------------------------------------------------------------

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export type ApiKeyContext = {
  organizationId: string;
  apiKeyId: string;
  scopes: string[];
};

export async function verifyApiKey(
  request: Request,
  requiredScope: string,
): Promise<ApiKeyContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const hashed = hashApiKey(match[1].trim());
  const key = await db.apiKey.findUnique({ where: { hashedKey: hashed } });
  if (!key || key.revokedAt) return null;

  // Constant-time comparison of the stored hash (defence in depth on top of
  // the unique lookup).
  const a = Buffer.from(hashed);
  const b = Buffer.from(key.hashedKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const scopes = key.scopes.split(",").map((s) => s.trim());
  if (!scopes.includes(requiredScope)) return null;

  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { organizationId: key.organizationId, apiKeyId: key.id, scopes };
}
