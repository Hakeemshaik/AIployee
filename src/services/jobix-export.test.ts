import { describe, expect, it } from "vitest";
import { plainWireName } from "./jobix-export";

// ---------------------------------------------------------------------------
// The name that leaves for the voice platform.
//
// A debtor with no surname on file carries an em-dash in ours so lists stay
// readable. That is a display convention. It reached the platform as part of
// the customer's name — "tester —" — on a write the platform accepted and
// discarded, and it is the sort of character a queue that validates its input
// refuses without saying so.
// ---------------------------------------------------------------------------

describe("plainWireName", () => {
  it("drops the placeholder standing in for a missing surname", () => {
    expect(plainWireName("tester —")).toBe("tester");
    expect(plainWireName("Naledi –")).toBe("Naledi");
    expect(plainWireName("Naledi -")).toBe("Naledi");
  });

  it("leaves a real name exactly as it is", () => {
    expect(plainWireName("Sipho Nkosi")).toBe("Sipho Nkosi");
    expect(plainWireName("Pieter van der Merwe")).toBe("Pieter van der Merwe");
    // Accents and apostrophes belong to people, not to us.
    expect(plainWireName("Renée Grové")).toBe("Renée Grové");
    expect(plainWireName("O'Brien Naidoo")).toBe("O'Brien Naidoo");
  });

  it("keeps a hyphenated surname, which is a name and not a placeholder", () => {
    expect(plainWireName("Anna Smit-Botha")).toBe("Anna Smit-Botha");
  });

  it("never returns nothing, because a nameless customer is unshowable", () => {
    expect(plainWireName("—")).toBe("Unknown");
    expect(plainWireName("   ")).toBe("Unknown");
  });
});
