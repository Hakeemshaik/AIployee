import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession, type Session } from "./session-token";

const SECRET = "test-secret-at-least-sixteen-chars";
const OTHER_SECRET = "a-completely-different-secret-key";
const FUTURE = Date.now() + 60_000;

describe("session token", () => {
  it("round-trips a user session", () => {
    const session: Session = { kind: "user", userId: "usr_123", expiresAt: FUTURE };
    const decoded = decodeSession(encodeSession(session, SECRET), SECRET);
    expect(decoded).toEqual(session);
  });

  it("round-trips a guest session", () => {
    const session: Session = { kind: "guest", expiresAt: FUTURE };
    expect(decodeSession(encodeSession(session, SECRET), SECRET)).toEqual(session);
  });

  it("rejects a token signed with a different secret", () => {
    const token = encodeSession({ kind: "user", userId: "usr_1", expiresAt: FUTURE }, OTHER_SECRET);
    expect(decodeSession(token, SECRET)).toBeNull();
  });

  it("rejects a guest session edited into a user session", () => {
    // The attack this whole scheme exists to stop: a demo visitor rewriting
    // their own cookie to claim a real account.
    const token = encodeSession({ kind: "guest", expiresAt: FUTURE }, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forgedPayload = Buffer.from(
      JSON.stringify({ kind: "user", userId: "usr_admin", expiresAt: FUTURE }),
      "utf8",
    ).toString("base64url");
    expect(decodeSession(`${forgedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a self-extended expiry", () => {
    const token = encodeSession({ kind: "user", userId: "usr_1", expiresAt: FUTURE }, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const stretched = Buffer.from(
      JSON.stringify({ kind: "user", userId: "usr_1", expiresAt: FUTURE + 10 * 365 * 86_400_000 }),
      "utf8",
    ).toString("base64url");
    expect(decodeSession(`${stretched}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects an expired session", () => {
    const token = encodeSession({ kind: "user", userId: "usr_1", expiresAt: Date.now() + 1000 }, SECRET);
    expect(decodeSession(token, SECRET)).not.toBeNull();
    // Same token, evaluated later.
    expect(decodeSession(token, SECRET, Date.now() + 2000)).toBeNull();
  });

  it("rejects a session expiring exactly now", () => {
    const now = Date.now();
    const token = encodeSession({ kind: "user", userId: "usr_1", expiresAt: now }, SECRET);
    expect(decodeSession(token, SECRET, now)).toBeNull();
  });

  it("rejects missing, empty and structurally broken tokens", () => {
    for (const bad of [
      undefined,
      null,
      "",
      ".",
      "onlypayload",
      ".onlysignature",
      "not.base64url.at.all",
      "a".repeat(50),
    ]) {
      expect(decodeSession(bad as string | undefined, SECRET), `should reject: ${bad}`).toBeNull();
    }
  });

  it("rejects an unsigned payload and a truncated signature", () => {
    const token = encodeSession({ kind: "user", userId: "usr_1", expiresAt: FUTURE }, SECRET);
    const payload = token.slice(0, token.lastIndexOf("."));
    expect(decodeSession(payload, SECRET)).toBeNull();
    expect(decodeSession(`${payload}.`, SECRET)).toBeNull();
    expect(decodeSession(token.slice(0, -2), SECRET)).toBeNull();
  });

  it("rejects an unknown session kind and a missing user id", () => {
    for (const payload of [
      { kind: "admin", expiresAt: FUTURE },
      { kind: "user", expiresAt: FUTURE },
      { kind: "user", userId: "", expiresAt: FUTURE },
      { kind: "user", userId: 42, expiresAt: FUTURE },
      { expiresAt: FUTURE },
      { kind: "guest" },
      { kind: "guest", expiresAt: "soon" },
      { kind: "guest", expiresAt: Number.POSITIVE_INFINITY },
    ]) {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const signature = createHmac("sha256", SECRET).update(encoded).digest("hex");
      expect(
        decodeSession(`${encoded}.${signature}`, SECRET),
        `should reject: ${JSON.stringify(payload)}`,
      ).toBeNull();
    }
  });

  it("rejects a payload that is valid JSON but not an object", () => {
    for (const raw of ['"a string"', "42", "null", "[]"]) {
      const encoded = Buffer.from(raw, "utf8").toString("base64url");
      const signature = createHmac("sha256", SECRET).update(encoded).digest("hex");
      expect(decodeSession(`${encoded}.${signature}`, SECRET), `should reject: ${raw}`).toBeNull();
    }
  });
});
