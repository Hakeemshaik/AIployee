import { randomBytes, scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, MIN_PASSWORD_LENGTH, passwordProblem, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("accepts the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("a long enough password");
    const b = await hashPassword("a long enough password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("a long enough password", a)).toBe(true);
    expect(await verifyPassword("a long enough password", b)).toBe(true);
  });

  it("records its parameters in the hash so they can be raised later", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("normalises unicode, so the same typed password works across platforms", async () => {
    // "é" as one code point vs "e" + combining accent.
    const composed = "café brûlée password";
    const decomposed = composed.normalize("NFD");
    expect(composed).not.toBe(decomposed);
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it("treats a user with no password exactly like a wrong password", async () => {
    // A null hash must not throw and must not pass — otherwise an account with
    // no password set would either crash sign-in or let anyone in.
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
    expect(await verifyPassword("", null)).toBe(false);
  });

  it("rejects malformed and tampered hashes instead of throwing", async () => {
    const good = await hashPassword("a long enough password");
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfiveparts",
      "bcrypt$16384$8$1$aabb$ccdd",
      "scrypt$notanumber$8$1$aabb$ccdd",
      good.replace("scrypt", "scrypt2"),
      good.slice(0, -4), // truncated key
      `${good}extra`,
    ]) {
      expect(await verifyPassword("a long enough password", bad), `should reject: ${bad}`).toBe(false);
    }
  });

  it("refuses absurd stored cost parameters rather than trying to allocate", async () => {
    const hostile = "scrypt$1099511627776$1024$99$aabb$ccdd";
    expect(await verifyPassword("anything", hostile)).toBe(false);
  });

  it("verifies a hash stored with different parameters than today's defaults", async () => {
    // A password hashed before the cost was raised must still work, or raising
    // the cost would lock every existing user out.
    const salt = randomBytes(16);
    const key: Buffer = await new Promise((resolve, reject) =>
      scrypt("a long enough password", salt, 64, { N: 1024, r: 8, p: 1 }, (err, k) =>
        err ? reject(err) : resolve(k),
      ),
    );
    const legacy = `scrypt$1024$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
    expect(await verifyPassword("a long enough password", legacy)).toBe(true);
    expect(await verifyPassword("the wrong password", legacy)).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("requires a usable length", () => {
    expect(passwordProblem("short")).toContain(String(MIN_PASSWORD_LENGTH));
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("rejects whitespace-only and absurdly long input", () => {
    expect(passwordProblem(" ".repeat(20))).toBe("Enter a password.");
    expect(passwordProblem("x".repeat(201))).toContain("200");
  });
});
