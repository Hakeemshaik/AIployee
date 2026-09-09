import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// ---------------------------------------------------------------------------
// Password hashing.
//
// scrypt from node:crypto — no new dependency, and memory-hard, so it resists
// GPU cracking in a way SHA-family hashing does not. Parameters are stored in
// the hash itself so they can be raised later without invalidating existing
// passwords.
// ---------------------------------------------------------------------------

const COST = 16_384; // N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** scrypt needs headroom above 32MB for these parameters. */
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  const options: ScryptOptions = { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY };
  return new Promise((resolve, reject) => {
    // Unicode is normalised so the same typed password verifies on any platform.
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const HEX_ONLY = /^[0-9a-f]+$/i;

function isHex(value: string): boolean {
  return value.length % 2 === 0 && HEX_ONLY.test(value);
}

/** Minimum we will accept. Deliberately length-based rather than a character-class rule. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "That is longer than 200 characters.";
  if (password.trim().length === 0) return "Enter a password.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a malformed or absent hash rather than throwing, so a user
 * row with no password behaves exactly like a wrong password to the caller —
 * the sign-in path must not reveal which accounts exist.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, costRaw, blockRaw, parallelRaw, saltHex, keyHex] = parts;
  const cost = Number(costRaw);
  const blockSize = Number(blockRaw);
  const parallelism = Number(parallelRaw);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }
  // Refuse absurd stored parameters instead of trying to allocate for them.
  if (cost > 1 << 20 || blockSize > 32 || parallelism > 16) return false;

  // Buffer.from(_, "hex") silently truncates at the first invalid character
  // instead of throwing, so trailing junk would decode to a valid-looking key.
  // The shape is checked before decoding.
  if (!isHex(saltHex) || !isHex(keyHex)) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  if (expected.length === 0 || salt.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, cost, blockSize, parallelism);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
