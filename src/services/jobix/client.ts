// ---------------------------------------------------------------------------
// Jobix read client.
//
// Every quirk below was confirmed against live production data. They are
// encoded as guards rather than comments, because each one produces a
// plausible-looking but wrong dataset when ignored:
//
//   * conversations: page_size=100 returns HTTP 500 — capped at 50 here
//   * pages are 1-indexed
//   * sort order is NOT reliably newest-first — callers always sort by
//     created_at themselves; assertSorted() is available for tests
//   * unrecognised filter params are accepted and silently ignored, so a
//     filtered pull is verified against the returned rows (see assertFilter)
//   * transcription requires the call_uuid query param — the same uuid — or
//     it returns 422
//   * customer fields are wrapped ({value, previous_value}) and empty ones
//     render as the literal "No data available"; unset units come back as
//     "{{ attributes.unit_number }}"
//   * timestamps are UTC; South Africa is UTC+2
//
// Server-side only. The token and company key never reach the browser.
// ---------------------------------------------------------------------------

export const CONVERSATIONS_MAX_PAGE_SIZE = 50; // 100 → HTTP 500
export const CUSTOMERS_MAX_PAGE_SIZE = 100; // fine on this endpoint

/** Filter params confirmed to actually filter. Anything else is ignored. */
export const SUPPORTED_CONVERSATION_FILTERS = ["phone", "agents"] as const;
export type SupportedConversationFilter = (typeof SUPPORTED_CONVERSATION_FILTERS)[number];

export class JobixError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "unauthorized"
      | "unavailable"
      | "rejected"
      | "not_found"
      | "invalid_response"
      | "workspace_mismatch"
      | "unsupported_filter",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "JobixError";
  }
}

export type JobixEnv = {
  base: string;
  apiBase: string;
  /** Static bearer token. Session sign-in (email/password) is preferred:
   *  the dashboard API only accepts the short-lived tokens a login mints. */
  token?: string;
  email?: string;
  password?: string;
  companyKey?: string;
  flowUuid?: string;
};

export function loadJobixEnv(): JobixEnv | null {
  const token = process.env.JOBIX_TOKEN ?? process.env.JOBIX_API_KEY;
  const email = process.env.JOBIX_EMAIL;
  const password = process.env.JOBIX_PASSWORD;
  // Configured = either credential style. Session sign-in wins when both are
  // set, because the static profile key does not open the dashboard API.
  if (!token && !(email && password)) return null;
  return {
    base: (process.env.JOBIX_BASE ?? "https://dashboard.jobix.ai").replace(/\/$/, ""),
    apiBase: (process.env.JOBIX_API_BASE ?? "https://dashboard-api.jobix.ai").replace(/\/$/, ""),
    token,
    email,
    password,
    companyKey: process.env.JOBIX_COMPANY_KEY,
    flowUuid: process.env.JOBIX_FLOW_UUID,
  };
}

/**
 * The environment, with a sign-in saved in the app overlaid on it.
 *
 * `loadJobixEnv` cannot see the database — it is synchronous and used in
 * render paths — so every gate that asks "is Jobix configured?" would answer
 * no for a deployment whose credential lives in the app rather than in an
 * environment variable. This is that question's async form, and the gates use
 * it.
 */
export async function resolveJobixEnv(): Promise<JobixEnv | null> {
  const env = loadJobixEnv();
  let stored: { email: string; password: string } | null = null;
  try {
    const { storedSignIn } = await import("./credentials");
    stored = await storedSignIn();
  } catch {
    // No store available; the environment alone decides.
  }
  let storedKey: string | null = null;
  try {
    const { storedCompanyKey } = await import("./credentials");
    storedKey = await storedCompanyKey();
  } catch {
    // No store available; the environment alone decides.
  }
  if (!stored && !storedKey) return env;
  const base = env ?? {
    base: (process.env.JOBIX_BASE ?? "https://dashboard.jobix.ai").replace(/\/$/, ""),
    apiBase: (process.env.JOBIX_API_BASE ?? "https://dashboard-api.jobix.ai").replace(/\/$/, ""),
    token: process.env.JOBIX_TOKEN ?? process.env.JOBIX_API_KEY,
    companyKey: process.env.JOBIX_COMPANY_KEY,
    flowUuid: process.env.JOBIX_FLOW_UUID,
  };
  return {
    ...base,
    ...(stored ? { email: stored.email, password: stored.password } : {}),
    ...(storedKey ? { companyKey: storedKey } : {}),
  };
}

/** Strip anything credential-shaped from text before it can be logged. */
export function redact(text: string): string {
  return text
    // Handles `Bearer abc…`, `token=abc…` and `"company_key":"abc…"`.
    .replace(/(Bearer|api[_-]?key|token|company_key|secret)["']?\s*[:=]?\s*["']?[A-Za-z0-9._\-]{8,}/gi, "$1 [redacted]")
    .slice(0, 500);
}

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PagedMeta = {
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  hasNextPage: boolean;
};

export class JobixClient {
  constructor(private env: JobixEnv) {}

  /** The configured flow, when one is set. Never exposes the token. */
  get flowUuid(): string | undefined {
    return this.env.flowUuid;
  }

  private get sessionMode(): boolean {
    return !!(this.env.email && this.env.password);
  }

  /**
   * The sign-in to use: the one an admin saved in the app, else the
   * environment's.
   *
   * Resolved here rather than at every call site, so a credential saved in the
   * app works for reading, writing, triggering and every scheduled job without
   * each of them having to know where it came from. Stored wins because it was
   * verified against Jobix when it was saved, while an environment variable is
   * only ever assumed to be right.
   */
  private async credentials(): Promise<{ email: string; password: string } | null> {
    try {
      const { storedSignIn } = await import("./credentials");
      const stored = await storedSignIn();
      if (stored) return stored;
    } catch {
      // The store is unreachable (no database, a rotated key). The environment
      // is still worth trying — failing here would take down a deployment that
      // never used the stored credential at all.
    }
    return this.sessionMode ? { email: this.env.email!, password: this.env.password! } : null;
  }

  /** Bearer token for a request — a fresh session token, or the static one. */
  private async bearer(force = false): Promise<string> {
    const credentials = await this.credentials();
    if (credentials) {
      const { getSessionToken } = await import("./auth");
      return getSessionToken(this.env.base, credentials.email, credentials.password, { force });
    }
    if (this.env.token) return this.env.token;
    throw new JobixError(
      "No Jobix sign-in is available. Sign in under Settings, or set JOBIX_EMAIL and JOBIX_PASSWORD.",
      "not_configured",
    );
  }

  /**
   * Bearer for the WRITE API, which is a different service from the dashboard.
   *
   * The dashboard's /api/* endpoints accept only the short-lived tokens a login
   * mints — established by testing the profile key against every plausible
   * header and host. The write API is not that service: it lives on another
   * host and authorises the workspace with `company_key` in the body, so the
   * static profile key is the credential it was built for.
   *
   * That distinction matters because a failing dashboard sign-in was blocking
   * customer writes that never needed a session at all. So the static token is
   * used here when there is one, and the session is the fallback.
   */
  private async writeBearer(force = false): Promise<string> {
    if (this.env.token && !force) return this.env.token;
    const credentials = await this.credentials();
    if (credentials) {
      const { getSessionToken } = await import("./auth");
      return getSessionToken(this.env.base, credentials.email, credentials.password, { force });
    }
    if (this.env.token) return this.env.token;
    throw new JobixError("No credential is configured for the write API.", "not_configured");
  }

  /**
   * GET against the dashboard API with retry + backoff. These endpoints time
   * out under sustained paging, so transient failures are retried rather than
   * aborting a long ingestion.
   */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.env.base}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let lastError: unknown;
    let relogged = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${await this.bearer()}`, Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
        const text = await response.text();

        if (response.status === 401 || response.status === 403) {
          // A session token expires hourly; mint a fresh one and retry once
          // before concluding the credentials are wrong.
          if (!relogged) {
            relogged = true;
            await this.bearer(true);
            continue;
          }
          throw new JobixError(
            this.sessionMode
              ? "Jobix rejected the session — check JOBIX_EMAIL and JOBIX_PASSWORD."
              // The static token is a dead end on this API: every /api/* endpoint
              // rejects it. Point at the fix rather than at the variable that
              // cannot work.
              : "Jobix rejected the static API token. The dashboard API only accepts a sign-in — set JOBIX_EMAIL and JOBIX_PASSWORD.",
            "unauthorized",
          );
        }
        if (response.status === 404) {
          throw new JobixError(`Jobix returned not found for ${path}.`, "not_found");
        }
        if (response.status === 422) {
          throw new JobixError(
            `Jobix rejected the request as unprocessable (422) for ${path} — check required query params.`,
            "rejected",
            redact(text),
          );
        }
        // 500 on this endpoint usually means page_size is too large.
        if (response.status >= 500) {
          throw new JobixError(
            `Jobix returned HTTP ${response.status} for ${path}. On /api/conversations this is usually page_size above ${CONVERSATIONS_MAX_PAGE_SIZE}.`,
            "unavailable",
            redact(text),
          );
        }
        if (!response.ok) {
          throw new JobixError(`Jobix rejected the request (HTTP ${response.status}).`, "rejected", redact(text));
        }
        if (!text) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new JobixError("Jobix returned a body that is not JSON.", "invalid_response", redact(text));
        }
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof JobixError
            ? err.code === "unavailable"
            : true; // network/abort errors are retryable
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await sleep(backoffMs(attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastError instanceof JobixError) throw lastError;
    const reason = lastError instanceof Error ? lastError.message : "network failure";
    throw new JobixError("Jobix is unreachable right now.", "unavailable", redact(reason));
  }

  /** POST against the write API base (customer/save lives there). */
  async postWrite<T>(path: string, body: unknown): Promise<T> {
    return this.post(`${this.env.apiBase}${path}`, body, false, true);
  }

  /**
   * POST to the write API with a stated bearer, instead of the resolved one.
   *
   * Only for the diagnostic that compares credential arrangements. Which value
   * belongs in the Authorization header and which belongs in the body has been
   * inferred rather than read all along, and inference has been wrong about
   * this integration repeatedly — so the arrangements are tried and the
   * platform's own answer decides.
   */
  async postWriteAs<T>(path: string, body: unknown, bearer: string): Promise<T> {
    return this.postWithBearer(`${this.env.apiBase}${path}`, body, bearer);
  }

  private async postWithBearer<T>(url: string, body: unknown, bearer: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) {
        throw new JobixError(
          `Jobix write failed (HTTP ${response.status}).`,
          response.status === 401 || response.status === 403 ? "unauthorized" : "rejected",
          redact(text),
        );
      }
      return (text ? JSON.parse(text) : {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** A session token, for a diagnostic that needs to name the credential. */
  async sessionToken(): Promise<string | null> {
    try {
      return await this.bearer();
    } catch {
      return null;
    }
  }

  /**
   * POST against the dashboard host. The flow trigger
   * (/api/nodes/now/trigger) lives here, NOT on the write API base — confirmed
   * from a DevTools capture of the flow builder's own Run button.
   */
  async postDashboard<T>(path: string, body: unknown): Promise<T> {
    return this.post(`${this.env.base}${path}`, body);
  }

  private async post<T>(
    url: string,
    body: unknown,
    retried = false,
    writeApi = false,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const token = writeApi ? await this.writeBearer(retried) : await this.bearer(retried);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await response.text();
      // One retry with the other credential. On the dashboard that means a
      // freshly minted session token (they expire hourly); on the write API it
      // means falling back from the static key to a session, or the reverse.
      if ((response.status === 401 || response.status === 403) && !retried) {
        if (writeApi || this.sessionMode) return this.post(url, body, true, writeApi);
      }
      if (!response.ok) {
        throw new JobixError(
          `Jobix write failed (HTTP ${response.status}) for ${redact(url)}.`,
          response.status === 401 || response.status === 403 ? "unauthorized" : "rejected",
          redact(text),
        );
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      if (err instanceof JobixError) throw err;
      throw new JobixError("Jobix write endpoint is unreachable.", "unavailable", redact(String(err)));
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- shared helpers ---------------------------------------------------------

/**
 * Unwrap a Jobix customer field.
 * Empty fields render as the literal "No data available"; an unset imported
 * unit comes back as the raw template placeholder. Both mean null.
 */
export const NO_DATA_SENTINELS = ["No data available", "{{ attributes.unit_number }}"];

export function unwrapField(field: unknown): string | null {
  const raw =
    field && typeof field === "object" && "value" in (field as Record<string, unknown>)
      ? (field as Record<string, unknown>).value
      : field;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (NO_DATA_SENTINELS.includes(text)) return null;
  // Any unresolved template placeholder is missing data.
  if (/^\{\{.*\}\}$/.test(text)) return null;
  return text;
}

export function unwrapNumber(field: unknown): number | null {
  const text = unwrapField(field);
  if (text === null) return null;
  const value = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function unwrapBoolean(field: unknown): boolean {
  const text = unwrapField(field);
  if (text === null) return false;
  return /^(yes|true|1|y)$/i.test(text);
}

/**
 * Assert that a filtered pull actually came back filtered.
 * Jobix accepts unknown filter params and returns an unfiltered list that
 * looks completely normal, so every filtered request is verified.
 */
export function assertFilter<T>(
  rows: T[],
  matches: (row: T) => boolean,
  context: string,
): T[] {
  const mismatched = rows.filter((row) => !matches(row));
  if (mismatched.length > 0) {
    throw new JobixError(
      `Jobix ignored the ${context} filter — ${mismatched.length} of ${rows.length} returned rows do not match. Filter client-side instead.`,
      "unsupported_filter",
    );
  }
  return rows;
}

/** Rejects a filter param that Jobix silently ignores. */
export function guardConversationFilters(filters: Record<string, unknown>): void {
  const unsupported = Object.keys(filters).filter(
    (key) => !SUPPORTED_CONVERSATION_FILTERS.includes(key as SupportedConversationFilter),
  );
  if (unsupported.length > 0) {
    throw new JobixError(
      `Jobix accepts but ignores these conversation filters: ${unsupported.join(", ")}. Only ${SUPPORTED_CONVERSATION_FILTERS.join(", ")} actually filter — pull unfiltered and filter in code.`,
      "unsupported_filter",
    );
  }
}
