import { describe, expect, it } from "vitest";
import {
  matchMessagingEvents,
  messagingChannel,
  nameKey,
} from "./messaging";

describe("messagingChannel", () => {
  it("recognises WhatsApp nodes however they are spelled", () => {
    expect(messagingChannel("Send WhatsApp reminder")).toBe("whatsapp");
    expect(messagingChannel("Whats App follow up")).toBe("whatsapp");
    expect(messagingChannel("WA nudge 2")).toBe("whatsapp");
  });

  it("recognises SMS and email nodes", () => {
    expect(messagingChannel("SMS payment link")).toBe("sms");
    expect(messagingChannel("Email statement")).toBe("email");
    expect(messagingChannel("E-Mail statement")).toBe("email");
  });

  it("recognises filter nodes", () => {
    expect(messagingChannel("Filter: balance over 5000")).toBe("filter");
  });

  it("falls back to other rather than guessing", () => {
    expect(messagingChannel("Node 14")).toBe("other");
    expect(messagingChannel(null)).toBe("other");
    expect(messagingChannel("")).toBe("other");
  });
});

describe("nameKey", () => {
  it("normalises case, punctuation and whitespace", () => {
    expect(nameKey("  Thandi   Nkosi ")).toBe("thandi nkosi");
    expect(nameKey("Pieter van der Merwe")).toBe("pieter van der merwe");
    expect(nameKey("O'Brien-Smith, J.")).toBe("o brien smith j");
  });

  it("keeps names with non-Latin letters intact", () => {
    expect(nameKey("Zoë Müller")).toBe("zoë müller");
  });

  it("does NOT reorder or drop name parts — that would merge different people", () => {
    expect(nameKey("Nkosi Thandi")).not.toBe(nameKey("Thandi Nkosi"));
    expect(nameKey("Thandi Nkosi")).not.toBe(nameKey("Thandi"));
  });

  it("returns null for empty or punctuation-only input", () => {
    expect(nameKey(null)).toBeNull();
    expect(nameKey("   ")).toBeNull();
    expect(nameKey("---")).toBeNull();
  });
});

describe("matchMessagingEvents", () => {
  const events = [
    { customerKey: "thandi nkosi", id: "a" },
    { customerKey: "thandi nkosi", id: "b" },
    { customerKey: "sipho dlamini", id: "c" },
  ];

  it("matches on the normalised name and nothing else", () => {
    const { events: matched, basis } = matchMessagingEvents("Thandi  Nkosi", events, [
      "Thandi Nkosi",
      "Sipho Dlamini",
    ]);
    expect(matched.map((e) => e.id)).toEqual(["a", "b"]);
    expect(basis).toBe("name");
  });

  it("flags an ambiguous match when two accounts share the name", () => {
    const { events: matched, basis } = matchMessagingEvents("Thandi Nkosi", events, [
      "Thandi Nkosi",
      "thandi nkosi",
      "Sipho Dlamini",
    ]);
    // Events are still returned — nothing is hidden — but attribution is not
    // presented as certain.
    expect(matched).toHaveLength(2);
    expect(basis).toBe("ambiguous_name");
  });

  it("reports none when the name has no messaging steps", () => {
    const { events: matched, basis } = matchMessagingEvents("Kagiso Molefe", events, [
      "Kagiso Molefe",
    ]);
    expect(matched).toEqual([]);
    expect(basis).toBe("none");
  });
});
