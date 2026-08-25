import { mockProvider } from "./mock";
import type { AIProvider } from "./types";

export type * from "./types";

// ---------------------------------------------------------------------------
// Provider factory. AI_PROVIDER=claude requires ANTHROPIC_API_KEY — without a
// key the platform silently runs on the deterministic mock so it always works.
// The Claude provider is imported lazily so the Anthropic SDK never loads
// (and its key is never touched) in mock mode.
// ---------------------------------------------------------------------------

export async function getAIProvider(): Promise<AIProvider> {
  if (process.env.AI_PROVIDER === "claude" && process.env.ANTHROPIC_API_KEY) {
    const { claudeProvider } = await import("./claude");
    return claudeProvider;
  }
  return mockProvider;
}
