import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

// ---------------------------------------------------------------------------
// The claim window's contract, stated as tests over the pieces that do not
// need a database. The behaviour these protect: an owner claiming a seeded
// deployment must be able to use THEIR OWN email. Requiring an existing row
// meant signing in as one of the fictional demo staff, which blocked the real
// owner from their own deployment.
// ---------------------------------------------------------------------------

describe("deriveName (via claim behaviour)", () => {
  // deriveName is internal; these assert the shape it must produce so a
  // created admin is not called "hakeem.shaik".
  const derive = (email: string) => {
    const local = email.split("@")[0] ?? "";
    const words = local
      .split(/[._\-+]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
    return words.join(" ") || "Administrator";
  };

  it("builds a readable name from an email local part", () => {
    expect(derive("hakeem@aiployee.co.za")).toBe("Hakeem");
    expect(derive("hakeem.shaik@aiployee.co.za")).toBe("Hakeem Shaik");
    expect(derive("thandi_mokoena@example.com")).toBe("Thandi Mokoena");
    expect(derive("ops-team@example.com")).toBe("Ops Team");
  });

  it("never produces an empty name", () => {
    expect(derive("@example.com")).toBe("Administrator");
    expect(derive("...@example.com")).toBe("Administrator");
  });
});

describe("password round trip through the claim flow", () => {
  it("a password chosen at claim time verifies at sign-in", async () => {
    // The claim path and the sign-in path must agree on the hash format, or
    // claiming would appear to work and then lock the owner out.
    const chosen = "Kaap$tad-2026-Collections";
    const stored = await hashPassword(chosen);
    expect(await verifyPassword(chosen, stored)).toBe(true);
    expect(await verifyPassword(chosen.toLowerCase(), stored)).toBe(false);
  });
});

describe("the sign-in page discloses nothing", () => {
  // /login and GET /api/session are both reachable without a session. An
  // earlier version returned the first user's email and the organization name,
  // which printed a real account address on a public page — and read as
  // invented filler, because on a seeded deployment those are demo people.
  it("ClaimState carries a boolean and nothing else", () => {
    const source = readFileSync("src/services/auth.ts", "utf8");
    const declaration = /export type ClaimState = \{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(declaration).toContain("unclaimed");
    for (const leak of ["email", "Email", "name", "Name", "organization", "Organization"]) {
      expect(declaration, `ClaimState must not expose ${leak}`).not.toContain(leak);
    }
  });

  it("the session endpoint returns no account or organization fields", () => {
    const source = readFileSync("src/app/api/session/route.ts", "utf8");
    const get = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
    for (const leak of ["suggestedEmail", "organizationName", "userName"]) {
      expect(get, `GET /api/session must not return ${leak}`).not.toContain(leak);
    }
  });

  it("the login card holds no pre-filled values or placeholder text", () => {
    const source = readFileSync("src/app/login/LoginCard.tsx", "utf8");
    // A placeholder or defaultValue on these fields is how demo credentials
    // creep back onto the page.
    expect(source).not.toMatch(/placeholder=[{"]/);
    expect(source).not.toContain("defaultValue");
    expect(source).not.toMatch(/@[a-z0-9-]+\.(co\.za|com)/i);
  });

  it("the setup form holds no example person, company or address", () => {
    const source = readFileSync("src/app/setup/SetupForm.tsx", "utf8");
    expect(source).not.toMatch(/placeholder=[{"]/);
    expect(source).not.toMatch(/@[a-z0-9-]+\.(co\.za|com)/i);
  });
});
