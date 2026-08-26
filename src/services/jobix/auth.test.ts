import { describe, expect, it } from "vitest";
import { extractAccessToken, jwtExpiryMs } from "./auth";

// A structurally valid JWT with a known exp (not a real credential).
function fakeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ typ: "access", exp, sub: "1" })).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("jwtExpiryMs", () => {
  it("reads exp from the payload in milliseconds", () => {
    expect(jwtExpiryMs(fakeJwt(1787758427))).toBe(1787758427000);
  });

  it("returns null for anything unreadable rather than guessing", () => {
    expect(jwtExpiryMs("not-a-jwt")).toBeNull();
    expect(jwtExpiryMs("a.b")).toBeNull();
    expect(jwtExpiryMs("a.!!!.c")).toBeNull();
    const noExp = Buffer.from(JSON.stringify({ sub: "1" })).toString("base64url");
    expect(jwtExpiryMs(`h.${noExp}.s`)).toBeNull();
  });
});

describe("extractAccessToken", () => {
  const token = fakeJwt(1787758427);

  it("reads the token from common JSON body shapes", () => {
    expect(extractAccessToken({ access_token: token }, [])).toBe(token);
    expect(extractAccessToken({ accessToken: token }, [])).toBe(token);
    expect(extractAccessToken({ token }, [])).toBe(token);
    expect(extractAccessToken({ data: { access_token: token } }, [])).toBe(token);
    expect(extractAccessToken({ tokens: { accessToken: token } }, [])).toBe(token);
  });

  it("falls back to the Set-Cookie header — where the captured login puts it", () => {
    const cookie = `access_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`;
    expect(extractAccessToken(null, [cookie])).toBe(token);
    expect(extractAccessToken({}, ["_ga=x", cookie, `refresh_token=${fakeJwt(99)}; Path=/`])).toBe(token);
  });

  it("never mistakes the refresh token or a non-JWT value for the access token", () => {
    expect(extractAccessToken({ access_token: "short" }, [])).toBeNull();
    expect(extractAccessToken(null, [`refresh_token=${token}; Path=/`])).toBeNull();
    expect(extractAccessToken(null, ["access_token=notajwt; Path=/"])).toBeNull();
  });

  it("returns null when nothing usable exists", () => {
    expect(extractAccessToken(null, [])).toBeNull();
    expect(extractAccessToken({ ok: true }, ["_ga=x"])).toBeNull();
  });
});
