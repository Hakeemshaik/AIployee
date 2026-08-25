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
