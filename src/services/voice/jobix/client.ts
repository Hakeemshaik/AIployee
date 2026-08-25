import { ProviderError } from "../types";

// ---------------------------------------------------------------------------
// Jobix HTTP client — server-side only.
//
// Credentials come from the environment and never reach the browser. Paths are
// supplied by the caller from per-organization configuration rather than being
// hard-coded here, so the integration only ever calls endpoints that have been
// confirmed to exist. An unconfigured path raises a precise error instead of a
// guessed request.
// ---------------------------------------------------------------------------

export type JobixConfig = {
  baseUrl: string;
  apiKey: string;
  /** capability -> path, e.g. { listConversations: "/conversations" } */
  endpoints: Record<string, string>;
};

export function loadJobixEnv(): { baseUrl?: string; apiKey?: string; webhookSecret?: string } {
  return {
    baseUrl: process.env.JOBIX_BASE_URL,
    apiKey: process.env.JOBIX_API_KEY,
    webhookSecret: process.env.JOBIX_WEBHOOK_SECRET,
  };
}

const TIMEOUT_MS = 20_000;

/** Redact anything credential-shaped before a message can reach a log or UI. */
export function redact(text: string): string {
  return text
    .replace(/(Bearer|api[_-]?key|token|secret)\s*[:=]?\s*[A-Za-z0-9._\-]{8,}/gi, "$1 [redacted]")
    .slice(0, 500);
}

export class JobixClient {
  constructor(private config: JobixConfig) {}

  path(capability: string): string | null {
    return this.config.endpoints[capability] ?? null;
  }

  async request<T>(
    capability: string,
    init: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      idempotencyKey?: string;
      /** Appended to the configured path, e.g. `/{id}/start`. */
      suffix?: string;
    } = {},
  ): Promise<T> {
    const path = this.path(capability);
    if (!path) {
      throw new ProviderError(
        `No Jobix endpoint is configured for "${capability}".`,
        "not_configured",
        capability,
      );
    }

    const url = new URL(
      `${this.config.baseUrl.replace(/\/$/, "")}${path}${init.suffix ?? ""}`,
    );
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "network failure";
      throw new ProviderError(
        "Jobix is unreachable right now.",
        "unavailable",
        redact(reason),
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "Jobix rejected the credentials. Check JOBIX_API_KEY.",
        "unauthorized",
        `HTTP ${response.status}`,
      );
    }
    if (response.status === 404) {
      throw new ProviderError("Jobix returned not found.", "not_found", `${capability} ${url.pathname}`);
    }
    if (!response.ok) {
      throw new ProviderError(
        `Jobix rejected the request (HTTP ${response.status}).`,
        "rejected",
        redact(text),
      );
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError(
        "Jobix returned a response that could not be parsed as JSON.",
        "invalid_response",
        redact(text),
      );
    }
  }
}
