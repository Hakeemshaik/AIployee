// ---------------------------------------------------------------------------
// Non-voice flow steps (WhatsApp, SMS, filter branches).
//
// Jobix records these in the flow's node history. Two constraints shape
// everything here:
//
//  * The rows carry `customer_name` and nothing else identifying — no phone,
//    no account number. So an account match is a NAME match, which is weaker
//    than the phone match used for calls. Callers are told the match basis so
//    the UI can label it honestly instead of implying certainty.
//  * The node itself only says what it is by its name in the flow definition,
//    so the channel is derived from that name and falls back to "other"
//    rather than guessing.
// ---------------------------------------------------------------------------

export const MESSAGING_CHANNELS = ["whatsapp", "sms", "email", "filter", "other"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

const CHANNEL_PATTERNS: [MessagingChannel, RegExp][] = [
  ["whatsapp", /\b(whats\s?app|wa\b|wapp)/i],
  ["sms", /\b(sms|text message|mobile message)\b/i],
  ["email", /\b(e-?mail|mailer)\b/i],
  ["filter", /\b(filter|condition|branch|if)\b/i],
];

/** Derive a channel from a flow node's name. Unknown names stay "other". */
export function messagingChannel(nodeName: string | null | undefined): MessagingChannel {
  if (!nodeName) return "other";
  for (const [channel, pattern] of CHANNEL_PATTERNS) {
    if (pattern.test(nodeName)) return channel;
  }
  return "other";
}

/**
 * Normalise a person's name for matching: lowercase, punctuation stripped,
 * whitespace collapsed. Deliberately does NOT reorder or drop name parts —
 * a looser key would silently merge different people.
 */
export function nameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key.length > 0 ? key : null;
}

export const CHANNEL_LABELS: Record<MessagingChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  filter: "Flow filter",
  other: "Flow step",
};

/** How an account was matched to a messaging event. */
export type MessagingMatchBasis = "name" | "ambiguous_name" | "none";

export const MATCH_BASIS_NOTES: Record<MessagingMatchBasis, string> = {
  name: "Matched by name — Jobix's node history carries no phone number or account key, so this is weaker than the call match.",
  ambiguous_name:
    "More than one account shares this name, so these steps cannot be attributed to one account with confidence.",
  none: "No messaging steps recorded against this name.",
};

/**
 * Resolve which of a set of events belong to one account name.
 *
 * Returns `ambiguous_name` when the same normalised name occurs on more than
 * one account in the book: the events are still returned so nothing is hidden,
 * but the caller must not present them as belonging to this account alone.
 */
export function matchMessagingEvents<T extends { customerKey: string | null }>(
  accountName: string,
  events: T[],
  namesInBook: string[],
): { events: T[]; basis: MessagingMatchBasis } {
  const key = nameKey(accountName);
  if (!key) return { events: [], basis: "none" };
  const matched = events.filter((e) => e.customerKey === key);
  if (matched.length === 0) return { events: [], basis: "none" };
  const sharing = namesInBook.filter((n) => nameKey(n) === key).length;
  return { events: matched, basis: sharing > 1 ? "ambiguous_name" : "name" };
}
