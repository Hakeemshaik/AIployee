import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// The Campaign Engine's acceptance criteria (§8), as tests.
//
// Jobix is mocked at exactly two seams: the write (`save`) and the ingest
// (`runIngestion`). Everything between — rounds, locks, guards, rollups,
// reconciliation — runs for real against the database, because the locks ARE
// database constraints and mocking them would test the mock.
// ---------------------------------------------------------------------------

const save = vi.hoisted(() => vi.fn(async () => ({ queued: true })));
const runIngestion = vi.hoisted(() => vi.fn(async () => ({ status: "completed" })));
const requireWorkspace = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, agentNames: ["Siya"], conversationTotal: 0, message: "ok" })),
);
const windowCheck = vi.hoisted(() => ({ allowed: true, reason: "test", sastTime: "10:00 SAST" }));

vi.mock("@/services/jobix/push", () => ({ save }));
vi.mock("@/services/jobix/ingest", () => ({ runIngestion }));
vi.mock("@/services/jobix/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/jobix/api")>();
  return { ...actual, requireWorkspace };
});
vi.mock("@/services/jobix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/jobix/client")>();
  return {
    ...actual,
    resolveJobixEnv: async () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      token: "t",
      companyKey: "ck",
    }),
    JobixClient: class {},
  };
});
vi.mock("./window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./window")>();
  return { ...actual, checkEngineWindow: () => windowCheck };
});

const { importIntoEngine, parseSheet, dedupeByPhone } = await import("./import");
const { buildRound, evaluateEligibility } = await import("./rounds");
const { startBatch, tickBatch, resumeBatch, EngineGuardError } = await import("./dial");
const { classifyBatch } = await import("./classify");
const { buildCampaignReport, completeCampaign, buildWorklists } = await import("./complete");

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

let orgId = "";
let userId = "";
let campaignId = "";

const phone = (n: number) => `+2782${String(1000000 + n).slice(-7)}`;

async function seedCampaign(accounts: { due: number; phone?: string | null }[], batchSize = 200) {
  const rows = accounts.map((a, i) => ({
    fullName: `Tenant ${i}`,
    greetingName: `Tenant ${i}`,
    phone: a.phone === undefined ? phone(i) : a.phone,
    balance: a.due,
    unitNumber: `U${i}`,
    buildingName: "Test Court",
    tenantCode: `T${i}`,
    sourceFile: "seed.xlsx",
    sourceRow: i + 2,
  }));
  await importIntoEngine(orgId, campaignId, userId, [
    { rows, skipped: [], format: "G" },
  ]);
  await db.campaign.update({ where: { id: campaignId }, data: { batchSize } });
}

/** Pretend the platform ran a call: one conversation with a transcript. */
async function simulateCall(
  accountPhone: string,
  options: { duration: number; userWords: number; userText?: string; at?: Date } = {
    duration: 60,
    userWords: 30,
  },
) {
  const uuid = `conv-${Math.random().toString(36).slice(2, 10)}`;
  const conversation = await db.jobixConversation.create({
    data: {
      organizationId: orgId,
      uuid,
      phone: accountPhone,
      durationSeconds: options.duration,
      startedAt: options.at ?? new Date(),
      sastHour: 10,
    },
  });
  const words = options.userText ?? "yes ".repeat(options.userWords).trim();
  await db.jobixTranscript.create({
    data: {
      organizationId: orgId,
      conversationId: conversation.id,
      conversationUuid: uuid,
      turns: JSON.stringify([
        { role: "assistant", text: "Your account is in arrears." },
        ...(options.userWords > 0 ? [{ role: "user", text: words }] : []),
      ]),
      userTurns: options.userWords > 0 ? 1 : 0,
      userWords: options.userWords,
      userText: options.userWords > 0 ? words : "",
      reached: options.userWords > 0,
    },
  });
  return uuid;
}

describe.skipIf(!scratch)("the campaign engine", () => {
  beforeEach(async () => {
    save.mockClear();
    windowCheck.allowed = true;
    await db.engineAttempt.deleteMany();
    await db.engineBatch.deleteMany();
    await db.engineAlert.deleteMany();
    await db.engineAccount.deleteMany();
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.campaign.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Engine Co", slug: "engine-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Op", email: "op@engine.test", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({
        data: {
          organizationId: orgId,
          name: "Engine Test",
          callingHoursStart: "08:00",
          callingHoursEnd: "12:00",
        },
      })
    ).id;
  });

  it("imports, dedupes, and batches by money, largest first", async () => {
    await seedCampaign(
      [{ due: 100 }, { due: 9000 }, { due: 500 }, { due: 7000 }, { due: 300, phone: null }],
      2,
    );
    const accounts = await db.engineAccount.findMany({ where: { campaignId } });
    expect(accounts).toHaveLength(5);
    expect(accounts.filter((a) => a.state === "undialable")).toHaveLength(1);

    const plan = await buildRound(orgId, campaignId, userId);
    expect(plan.round).toBe(1);
    expect(plan.accounts).toBe(4); // the phoneless one is not dialled
    expect(plan.batches.map((b) => b.arrears)).toEqual([16000, 600]); // 9000+7000, 500+100
    expect(plan.batches[0].code).toMatch(/^\d{2}[A-Z]{3}-R1-B1$/);
  });

  it("refuses to start B2 before B1 is complete, and outside the window", async () => {
    await seedCampaign([{ due: 100 }, { due: 200 }, { due: 300 }], 2);
    await buildRound(orgId, campaignId, userId);
    const [b1, b2] = await db.engineBatch.findMany({ where: { campaignId }, orderBy: { index: "asc" } });

    await expect(startBatch(orgId, b2.id, userId)).rejects.toThrow(/must finish first/);

    windowCheck.allowed = false;
    windowCheck.reason = "No calls on Sundays — test";
    await expect(startBatch(orgId, b1.id, userId)).rejects.toThrow(/Sundays/);
    windowCheck.allowed = true;
    windowCheck.reason = "test";
  });

  it("drips writes at the concurrency pace instead of bursting the batch", async () => {
    await seedCampaign([{ due: 100 }, { due: 200 }, { due: 300 }, { due: 400 }, { due: 500 }, { due: 600 }], 200);
    await db.campaign.update({ where: { id: campaignId }, data: { maxConcurrency: 4 } });
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });

    const first = await startBatch(orgId, batch.id, userId);
    // Minute zero: at most one burst of max_concurrency, not the whole batch.
    expect(first.uploaded).toBe(4);
    expect(save).toHaveBeenCalledTimes(4);
  });

  it("counts each conversation once, whatever order results arrive in", async () => {
    await seedCampaign([{ due: 1000 }], 200);
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });
    await startBatch(orgId, batch.id, userId);

    const account = await db.engineAccount.findFirstOrThrow({ where: { campaignId } });
    await simulateCall(account.phone!, { duration: 90, userWords: 40 });

    await classifyBatch(orgId, batch.id);
    await classifyBatch(orgId, batch.id); // a second pass must change nothing
    expect(await db.engineAttempt.count()).toBe(1);

    const rolled = await db.engineAccount.findFirstOrThrow({ where: { id: account.id } });
    expect(rolled.state).toBe("reached");
    expect(rolled.attempts).toBe(1);
  });

  it("classifies reach from the transcript, never the platform's fields", async () => {
    await seedCampaign([{ due: 1000 }, { due: 900 }, { due: 800 }], 200);
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });
    await startBatch(orgId, batch.id, userId);
    const accounts = await db.engineAccount.findMany({ where: { campaignId }, orderBy: { totalDue: "desc" } });

    await simulateCall(accounts[0].phone!, { duration: 45, userWords: 30 }); // SPOKE
    await simulateCall(accounts[1].phone!, {
      duration: 20,
      userWords: 6,
      userText: "please leave a message after the tone",
    }); // VOICEMAIL
    await simulateCall(accounts[2].phone!, { duration: 0, userWords: 0 }); // ZERO_DURATION
    await classifyBatch(orgId, batch.id);

    const attempts = await db.engineAttempt.findMany({ orderBy: { startedAt: "asc" } });
    expect(attempts.map((a) => a.reach).sort()).toEqual(["SPOKE", "VOICEMAIL", "ZERO_DURATION"]);
    expect(attempts.find((a) => a.reach === "SPOKE")?.substantive).toBe(true);
  });

  it("captures a stated promise as PTP and resolves the account", async () => {
    await seedCampaign([{ due: 3000 }], 200);
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });
    await startBatch(orgId, batch.id, userId);
    const account = await db.engineAccount.findFirstOrThrow({ where: { campaignId } });

    await simulateCall(account.phone!, {
      duration: 120,
      userWords: 25,
      userText: "yes I understand I will pay the full amount of R3,000 tomorrow morning first thing I promise",
    });
    await classifyBatch(orgId, batch.id);

    const rolled = await db.engineAccount.findFirstOrThrow({ where: { id: account.id } });
    expect(rolled.outcome).toBe("PTP");
    expect(rolled.state).toBe("resolved");
  });

  it("pauses a batch when the zero-duration rate crosses 35% — and a voided re-run does not consume attempts", async () => {
    const book = Array.from({ length: 30 }, (_, i) => ({ due: 1000 + i }));
    await seedCampaign(book, 200);
    await db.campaign.update({ where: { id: campaignId }, data: { maxConcurrency: 30 } });
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });
    await startBatch(orgId, batch.id, userId);

    // 25 of the first 25 calls connect for zero seconds — a carrier failure.
    const accounts = await db.engineAccount.findMany({ where: { campaignId }, take: 25 });
    for (const account of accounts) {
      await simulateCall(account.phone!, { duration: 0, userWords: 0 });
    }
    // Force the drip cursor to look mid-batch so the pause has something to save.
    await db.engineBatch.update({ where: { id: batch.id }, data: { uploadedCount: 25 } });
    const tick = await tickBatch(orgId, batch.id);
    expect(tick.status).toBe("paused");
    expect(tick.pausedReason).toMatch(/zero-duration|delivery/i);

    // Void and re-run: the dials stay on record, nobody's cap moved.
    await resumeBatch(orgId, batch.id, userId, { voidAndRerun: true, maxConcurrency: 2 });
    const voided = await db.engineAttempt.count({ where: { voided: true } });
    expect(voided).toBe(25);
    const counts = await db.engineAccount.findMany({ where: { campaignId }, select: { attempts: true } });
    expect(Math.max(...counts.map((c) => c.attempts))).toBe(0);
  });

  it("builds round 2 from exactly the redialable set — §5.1", async () => {
    await seedCampaign(
      [
        { due: 9000 }, // will be PTP → excluded, human worklist
        { due: 8000 }, // spoke, no outcome → redial
        { due: 7000 }, // never answered → redial
        { due: 6000, phone: null }, // undialable → excluded
      ],
      200,
    );
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });
    await startBatch(orgId, batch.id, userId);
    const [a1, a2, a3] = await db.engineAccount.findMany({
      where: { campaignId, phone: { not: null } },
      orderBy: { totalDue: "desc" },
    });

    await simulateCall(a1.phone!, { duration: 100, userWords: 30, userText: "I will pay R9,000 on friday I promise you" });
    await simulateCall(a2.phone!, { duration: 60, userWords: 20, userText: "hello yes speaking who is this what do you want from me today" });
    await simulateCall(a3.phone!, { duration: 5, userWords: 0 });
    await classifyBatch(orgId, batch.id);
    await db.engineBatch.update({ where: { id: batch.id }, data: { status: "complete" } });
    await db.campaign.update({ where: { id: campaignId }, data: { engineStatus: "between_rounds" } });

    const plan = await buildRound(orgId, campaignId, userId);
    expect(plan.round).toBe(2);
    expect(plan.accounts).toBe(2); // a2 (no outcome) and a3 (no answer)
    expect(plan.excluded.find((e) => e.reason === "resolved: PTP")?.count).toBe(1);
    expect(plan.excluded.find((e) => e.reason === "no usable number")?.count).toBe(1);

    // Lock 2 in round 2: an account with a live attempt this round refuses.
    const batch2 = await db.engineBatch.findFirstOrThrow({ where: { campaignId, round: 2 } });
    await startBatch(orgId, batch2.id, userId);
    await simulateCall(a2.phone!, { duration: 30, userWords: 20 });
    await classifyBatch(orgId, batch2.id);
    await expect(startBatch(orgId, batch2.id, userId)).rejects.toThrow(EngineGuardError);
  });

  it("exhausts at the cap and routes the arrears to the switch-channel table", async () => {
    await seedCampaign([{ due: 5000 }], 200);
    await db.campaign.update({ where: { id: campaignId }, data: { maxRounds: 2 } });
    const account = await db.engineAccount.findFirstOrThrow({ where: { campaignId } });

    for (let round = 1; round <= 2; round += 1) {
      await buildRound(orgId, campaignId, userId);
      const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId, round } });
      await startBatch(orgId, batch.id, userId);
      await simulateCall(account.phone!, { duration: 3, userWords: 0 });
      await classifyBatch(orgId, batch.id);
      await db.engineBatch.update({ where: { id: batch.id }, data: { status: "complete" } });
      await db.campaign.update({ where: { id: campaignId }, data: { engineStatus: "between_rounds" } });
    }

    await expect(buildRound(orgId, campaignId, userId)).rejects.toThrow(/last automated round|switch-channel/i);
    const report = await buildCampaignReport(orgId, campaignId);
    // Not yet marked exhausted (that happens at completion), but never dialled
    // again either way; complete and check the switch-channel table.
    await completeCampaign(orgId, campaignId, userId);
    const finalReport = await buildCampaignReport(orgId, campaignId);
    expect(finalReport.switchChannel).toEqual({ count: 1, arrears: 5000 });
    expect(report.perAccount).toBe(true);
  });

  it("reconciles the worklists exactly and freezes on complete", async () => {
    await seedCampaign(
      [{ due: 1000 }, { due: 2000 }, { due: 3000, phone: null }],
      200,
    );
    await db.campaign.update({ where: { id: campaignId }, data: { maxRounds: 1 } });
    await buildRound(orgId, campaignId, userId);
    const batch = await db.engineBatch.findFirstOrThrow({ where: { campaignId } });
    await startBatch(orgId, batch.id, userId);
    const dialable = await db.engineAccount.findMany({ where: { campaignId, phone: { not: null } }, orderBy: { totalDue: "desc" } });

    await simulateCall(dialable[0].phone!, { duration: 90, userWords: 25, userText: "this is a dispute I do not owe this it is not my account at all" });
    await simulateCall(dialable[1].phone!, { duration: 0, userWords: 0 });
    await classifyBatch(orgId, batch.id);
    await db.engineBatch.update({ where: { id: batch.id }, data: { status: "complete" } });
    await db.campaign.update({ where: { id: campaignId }, data: { engineStatus: "between_rounds" } });

    const report = await completeCampaign(orgId, campaignId, userId);
    expect(report.reconciled).toBe(true);
    expect(report.worklists.reduce((s, l) => s + l.count, 0)).toBe(report.accounts);
    expect(report.worklists.reduce((s, l) => s + l.arrears, 0)).toBe(report.bookValue);

    const lists = await buildWorklists(orgId, campaignId);
    expect(lists.disputes).toHaveLength(1);
    expect(lists.no_contact).toHaveLength(1);

    const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
    expect(campaign.engineStatus).toBe("complete");
    // Frozen: no more rounds, ever.
    await expect(buildRound(orgId, campaignId, userId)).rejects.toThrow(/cannot be cut|complete/i);
  });

  it("keeps the pure pieces honest: dedupe feeds import feeds eligibility", async () => {
    const parsed = parseSheet(
      [
        ["Building", "Unit", "Tenant", "Balance", "Contact"],
        ["Court", "U1", "MRS T MOKOENA", "1000", "0821230001"],
        ["Court", "P9", "MRS T MOKOENA", "500", "0821230001"],
      ],
      { tenant: 2, bal: 3, phone: 4, unit: 1, building: 0, code: null },
      "b.xlsx",
      0,
      "G",
    );
    const deduped = dedupeByPhone(parsed.rows);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].totalDue).toBe(1500);

    const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
    const verdict = evaluateEligibility(campaign, []);
    expect(verdict.eligible).toHaveLength(0);
  });
});
