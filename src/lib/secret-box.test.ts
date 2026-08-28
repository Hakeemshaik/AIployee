import { describe, expect, it } from "vitest";
import { open, seal } from "./secret-box";

// A credential the server presents to another system has to be recoverable, so
// the properties that matter are: it round-trips, the stored form does not
// contain the plaintext, tampering fails closed, and an unreadable value is
// null rather than an exception the caller has to remember to catch.
const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("secret box", () => {
  it("round-trips a value", async () => {
    const secret = "aJ?9p({6S519";
    expect(await open(await seal(secret))).toBe(secret);
  });

  it("never stores the plaintext, and never the same ciphertext twice", async () => {
    const first = await seal("the-same-password");
    const second = await seal("the-same-password");
    expect(first).not.toContain("the-same-password");
    expect(first).not.toBe(second);
    expect(await open(second)).toBe("the-same-password");
  });

  it("refuses a tampered value instead of decrypting it to something else", async () => {
    const sealed = await seal("original");
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64url");
    expect(await open(parts.join("."))).toBeNull();
  });

  it("returns null for anything unreadable rather than throwing", async () => {
    for (const bad of ["", "not-sealed", "v0.a.b.c", "v1.only.three"]) {
      expect(await open(bad)).toBeNull();
    }
  });
});
