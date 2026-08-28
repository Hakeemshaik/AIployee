import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { sessionSecret } from "@/lib/session";

// ---------------------------------------------------------------------------
// Encrypting a secret the server has to be able to read back.
//
// A password hash is one-way, which is right for verifying a person. This is
// the other case: a credential the platform must present to another system, so
// it has to be recoverable. Recoverable is not the same as readable — the
// stored form is useless without the key, and the key is not in the database.
//
// AES-256-GCM, so a tampered ciphertext fails to decrypt rather than
// decrypting to something else. The key is derived with HKDF from the session
// secret under its own label, so the same secret protecting cookies cannot be
// confused with the one protecting this.
//
// Honest about the boundary: anyone holding BOTH the database and the session
// secret can recover the plaintext. That is the trade this exists to make —
// against a credential that only works when an environment variable is
// correct, on a deployment where that has repeatedly gone wrong.
// ---------------------------------------------------------------------------

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const INFO = Buffer.from("aiployee.secret-box.v1");

async function key(): Promise<Buffer> {
  const secret = await sessionSecret();
  // No salt: the secret is already high-entropy, and a stored salt would have
  // to live beside the ciphertext without adding anything against an attacker
  // who already has the database.
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), INFO, KEY_BYTES));
}

export async function seal(plaintext: string): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null rather than throwing for anything unreadable — a rotated
 * AUTH_SECRET, a truncated row, a value from an older scheme. The caller's
 * answer to "no stored credential" and "a stored credential I cannot read" is
 * the same: ask for it again.
 */
export async function open(sealed: string): Promise<string | null> {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", await key(), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
