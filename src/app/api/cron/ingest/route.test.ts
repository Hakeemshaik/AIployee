import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// This endpoint runs with no signed-in user, so its refusals are the security
// boundary and are tested as such: no secret configured, a wrong secret, a
// missing header, and a multi-organization deployment must all be refused
// before anything is pulled.
// ---------------------------------------------------------------------------

const ingest = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());

vi.mock("@/services/jobix/ingest", () => ({ runIngestion: ingest }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { organization: { findMany } } }));

async function call(headers: Record<string, string> = {}) {
  const { GET } = await import("./route");
  return GET(new Request("https://example.test/api/cron/ingest", { headers }));
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

describe("scheduled import endpoint", () => {
  it("refuses to run at all when no secret is configured", async () => {
    const response = await call({ authorization: "Bearer anything" });

    expect(response.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses a request with no authorization header", async () => {
    process.env.CRON_SECRET = "s3cret-value-long-enough";
    findMany.mockResolvedValue([{ id: "org-1" }]);

    const response = await call();

    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret, including one that is merely a prefix", async () => {
    process.env.CRON_SECRET = "s3cret-value-long-enough";
    findMany.mockResolvedValue([{ id: "org-1" }]);

    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-value-long-enoug" })).status).toBe(401);
    expect((await call({ authorization: "s3cret-value-long-enough" })).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses a multi-organization deployment, which has no session to scope the pull", async () => {
    process.env.CRON_SECRET = "s3cret-value-long-enough";
    findMany.mockResolvedValue([{ id: "org-1" }, { id: "org-2" }]);

    const response = await call({ authorization: "Bearer s3cret-value-long-enough" });

    expect(response.status).toBe(409);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("imports a bounded recent window, never everything", async () => {
    process.env.CRON_SECRET = "s3cret-value-long-enough";
    findMany.mockResolvedValue([{ id: "org-1" }]);
    ingest.mockResolvedValue({
      runId: "run-1",
      status: "completed",
      conversationsFound: 12,
      transcriptsFetched: 12,
      transcriptsPending: 0,
    });

    const response = await call({ authorization: "Bearer s3cret-value-long-enough" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", conversations: 12 });

    const options = ingest.mock.calls[0][0];
    expect(options.organizationId).toBe("org-1");
    // A floor is always set: a schedule that could ask for the whole database
    // would be a way to burn the request budget on demand.
    expect(options.since).toBeInstanceOf(Date);
    const days = (Date.now() - options.since.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(1.9);
    expect(days).toBeLessThan(2.1);
  });

  it("reports a provider failure as a failure rather than a success", async () => {
    process.env.CRON_SECRET = "s3cret-value-long-enough";
    findMany.mockResolvedValue([{ id: "org-1" }]);
    ingest.mockRejectedValue(new Error("Jobix rejected the sign-in"));

    const response = await call({ authorization: "Bearer s3cret-value-long-enough" });

    expect(response.status).toBe(502);
    expect((await response.json()).message).toMatch(/rejected the sign-in/);
  });
});
