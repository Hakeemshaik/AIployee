/**
 * Demo seed — realistic fictional South African collection data (ZAR).
 *
 * Everything created here is MOCK DATA for the demo organization; production
 * data enters the platform through the voice integration API and the UI.
 * The seed is deterministic (fixed RNG seed) apart from being anchored to
 * "now", so charts and due dates always look current.
 *
 * Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { mockProvider } from "../src/services/ai/mock";
import { buildCollectionSnapshot } from "../src/services/insights";

const db = new PrismaClient();

// --- deterministic RNG -------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260824);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const int = (min: number, max: number) => Math.floor(between(min, max + 1));
const chance = (p: number) => rand() < p;
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const daysAhead = (d: number) => new Date(now.getTime() + d * 86_400_000);
const atHour = (date: Date, hour: number, minute: number) => {
  const d = new Date(date);
  d.setHours(hour, minute, int(0, 59), 0);
  return d;
};
const longDate = (d: Date) =>
  d.toLocaleDateString("en-ZA", { day: "numeric", month: "long" });

// --- data pools --------------------------------------------------------------
const FIRST_NAMES = [
  "Sipho", "Thandi", "Lerato", "Bongani", "Nomvula", "Kagiso", "Ayanda", "Pieter",
  "Annelie", "Johan", "Marike", "Riaan", "Charmaine", "Kevin", "Priya", "Rajesh",
  "Fatima", "Yusuf", "Naledi", "Tumelo", "Zanele", "Mandla", "Precious", "Karabo",
  "Dineo", "Xolani", "Andile", "Nonhlanhla", "Themba", "Busisiwe", "Gugu", "Sibusiso",
  "Elna", "Werner", "Tasneem", "Imraan", "Refilwe", "Katlego", "Palesa", "Vusi",
];
const LAST_NAMES = [
  "Nkosi", "Dlamini", "Mokoena", "van der Merwe", "Botha", "Naidoo", "Pillay",
  "Khumalo", "Mahlangu", "Sithole", "Pretorius", "Jacobs", "Fourie", "Ndlovu",
  "Mthembu", "Petersen", "Adams", "Ismail", "Molefe", "Radebe", "Sibiya", "Cele",
  "du Plessis", "Venter", "Maharaj", "Govender", "Tshabalala", "Mabaso", "Modise",
  "September", "Hendricks", "Mnguni", "Zwane", "Sono", "Baloyi",
];
const LOCATIONS = [
  ["Johannesburg", "Gauteng"], ["Soweto", "Gauteng"], ["Pretoria", "Gauteng"],
  ["Tembisa", "Gauteng"], ["Durban", "KwaZulu-Natal"], ["Pietermaritzburg", "KwaZulu-Natal"],
  ["Cape Town", "Western Cape"], ["Mitchells Plain", "Western Cape"], ["Gqeberha", "Eastern Cape"],
  ["East London", "Eastern Cape"], ["Bloemfontein", "Free State"], ["Polokwane", "Limpopo"],
  ["Mbombela", "Mpumalanga"], ["Rustenburg", "North West"], ["Kimberley", "Northern Cape"],
] as const;

type Outcome =
  | "promise_to_pay" | "payment_arrangement" | "paid_in_full_claimed" | "dispute"
  | "financial_hardship" | "refused_to_pay" | "wrong_number" | "callback_requested"
  | "no_commitment" | "opted_out";

const OUTCOME_WEIGHTS: [Outcome, number][] = [
  ["promise_to_pay", 0.30], ["payment_arrangement", 0.11], ["callback_requested", 0.12],
  ["no_commitment", 0.17], ["financial_hardship", 0.09], ["dispute", 0.05],
  ["refused_to_pay", 0.06], ["wrong_number", 0.04], ["paid_in_full_claimed", 0.04],
  ["opted_out", 0.02],
];
function pickOutcome(): Outcome {
  let r = rand();
  for (const [outcome, w] of OUTCOME_WEIGHTS) {
    r -= w;
    if (r <= 0) return outcome;
  }
  return "no_commitment";
}

const NONPAYMENT_REASON: Record<string, string> = {
  promise_to_pay: "temporary_cash_flow",
  payment_arrangement: "temporary_cash_flow",
  financial_hardship: "retrenchment_or_job_loss",
  dispute: "disputes_amount",
  no_commitment: "forgot_or_unaware",
};

// --- transcript generation ---------------------------------------------------
function transcript(
  agent: string,
  firstName: string,
  creditor: string,
  balance: number,
  outcome: Outcome,
  promisedAmount: number | null,
  promisedDate: Date | null,
  installments: number | null,
): string {
  const bal = `R${Math.round(balance).toLocaleString("en-ZA")}`;
  const amt = promisedAmount ? `R${Math.round(promisedAmount).toLocaleString("en-ZA")}` : bal;
  const date = promisedDate ? longDate(promisedDate) : "next week";
  const open = [
    `${agent} (AI): Good day, may I speak to ${firstName}? This call is recorded for quality and compliance purposes.`,
    `${firstName}: Yes, speaking.`,
    `${agent} (AI): Thank you. I'm calling from Meridian Recoveries on behalf of ${creditor} regarding an outstanding balance of ${bal} on your account. Do you have a moment to discuss it?`,
  ];
  const bodies: Record<Outcome, string[]> = {
    promise_to_pay: [
      `${firstName}: I know about it, things have just been tight this month.`,
      `${agent} (AI): I understand. Is there a date you could make a payment?`,
      `${firstName}: I get paid on the 25th. I'll pay ${amt} on ${date}.`,
      `${agent} (AI): Thank you — I've noted a payment of ${amt} on ${date}. I'll send an SMS with the payment details. Is there anything else I can help with?`,
      `${firstName}: No, that's fine. Thanks.`,
    ],
    payment_arrangement: [
      `${firstName}: I can't pay it all at once, but I don't want this hanging over me.`,
      `${agent} (AI): We can look at an arrangement. Would ${installments ?? 3} monthly payments of R${Math.round((promisedAmount ?? balance) / (installments ?? 3)).toLocaleString("en-ZA")} work for you?`,
      `${firstName}: Yes, I can manage that. Let's split it into ${installments ?? 3} monthly payments starting on ${date}.`,
      `${agent} (AI): Perfect, that works. I've set up the payment plan and you'll receive the details by SMS. Thank you for sorting this out today.`,
    ],
    paid_in_full_claimed: [
      `${firstName}: I already paid this off in June. I have the proof of payment.`,
      `${agent} (AI): Thank you for letting me know. I'll flag the account for reconciliation — could you email the proof of payment to us so we can verify and close it?`,
      `${firstName}: Sure, send me the address.`,
    ],
    dispute: [
      `${firstName}: This is not my debt. I never opened an account with ${creditor}.`,
      `${agent} (AI): I'm sorry to hear that. I'm registering a formal dispute on the account, and all collection activity will be paused while a specialist reviews it. You'll be contacted within a few business days.`,
      `${firstName}: Good. Please sort it out, I'm sick of these calls.`,
    ],
    financial_hardship: [
      `${firstName}: I was retrenched in May. I honestly can't afford anything right now.`,
      `${agent} (AI): I'm sorry to hear that, and thank you for telling me. I'm flagging your account for our affordability team — a human consultant will contact you about hardship options. No payment is being demanded on this call.`,
      `${firstName}: Okay. I do want to pay when I'm back on my feet.`,
    ],
    refused_to_pay: [
      `${firstName}: I'm not going to pay this. Take me to court if you want.`,
      `${agent} (AI): I understand you don't intend to pay. I have to note that the balance remains due and the account may proceed to the next stage of the collections process. If your situation changes, you can contact us any time.`,
    ],
    wrong_number: [
      `${firstName}: You have the wrong person. There's no one by that name here.`,
      `${agent} (AI): My apologies for the inconvenience. I'll remove this number from the account and mark the contact details for verification. Have a good day.`,
    ],
    callback_requested: [
      `${firstName}: I'm at work right now, I can't talk. Call me back after five.`,
      `${agent} (AI): No problem — I'll schedule a callback for later today. Thank you.`,
    ],
    no_commitment: [
      `${firstName}: I wasn't aware it was this much. I need to check my statements first.`,
      `${agent} (AI): That's fair. I'll send a statement summary by SMS so you can review it. Could we agree that you'll come back to us within the week?`,
      `${firstName}: Maybe. I'm not promising anything yet.`,
    ],
    opted_out: [
      `${firstName}: Stop calling me. Do not contact me again on this number.`,
      `${agent} (AI): Understood. I'm recording your opt-out now and this number will not be contacted again. Any correspondence will follow the permitted channels. Goodbye.`,
    ],
  };
  return [...open, ...bodies[outcome]].join("\n");
}

const SUMMARIES: Record<Outcome, (name: string, amt: string, date: string) => string> = {
  promise_to_pay: (n, a, d) => `${n} acknowledged the debt and committed to paying ${a} on ${d}, citing temporary cash-flow pressure until payday.`,
  payment_arrangement: (n, a) => `${n} could not settle in full and agreed to a monthly payment plan totalling ${a}. First installment confirmed.`,
  paid_in_full_claimed: (n) => `${n} claims the account was already settled and will provide proof of payment. Flagged for reconciliation before any further contact.`,
  dispute: (n) => `${n} disputes owing the debt and says the account is not theirs. Formal dispute registered; collection paused pending human review.`,
  financial_hardship: (n) => `${n} reported retrenchment and inability to pay. Flagged for the affordability team; no payment demanded on the call.`,
  refused_to_pay: (n) => `${n} explicitly refused to pay and invited legal action. Account noted for next-stage review.`,
  wrong_number: () => `The number reached a different person. Contact details marked for re-verification.`,
  callback_requested: (n) => `${n} was unavailable and requested a callback after working hours. Callback scheduled.`,
  no_commitment: (n) => `${n} wanted to verify the balance before committing. Statement sent by SMS; soft follow-up agreed.`,
  opted_out: (n) => `${n} demanded no further contact. Opt-out recorded and the number suppressed from dialling.`,
};

async function main() {
  console.log("Clearing existing data…");
  // Order matters for FK constraints.
  await db.auditLog.deleteMany();
  await db.platformEvent.deleteMany();
  await db.aIInsight.deleteMany();
  await db.report.deleteMany();
  await db.payment.deleteMany();
  await db.promiseToPay.deleteMany();
  await db.escalation.deleteMany();
  await db.callAnalysis.deleteMany();
  await db.call.deleteMany();
  await db.debtAccount.deleteMany();
  await db.debtor.deleteMany();
  await db.campaign.deleteMany();
  await db.aIAgent.deleteMany();
  await db.apiKey.deleteMany();
  await db.complianceSettings.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();

  console.log("Creating organization, users, compliance settings…");
  const org = await db.organization.create({
    data: { name: "Meridian Recoveries", slug: "meridian-recoveries" },
  });
  const orgId = org.id;

  await db.user.createMany({
    data: [
      { organizationId: orgId, name: "Thandi Mokoena", email: "thandi@meridianrecoveries.co.za", role: "admin" },
      { organizationId: orgId, name: "Pieter van der Merwe", email: "pieter@meridianrecoveries.co.za", role: "manager" },
      { organizationId: orgId, name: "Lerato Dlamini", email: "lerato@meridianrecoveries.co.za", role: "collector" },
      { organizationId: orgId, name: "Yusuf Ismail", email: "yusuf@meridianrecoveries.co.za", role: "collector" },
    ],
  });
  const users = await db.user.findMany({ where: { organizationId: orgId } });
  const collectors = users.filter((u) => u.role === "collector");

  await db.complianceSettings.create({ data: { organizationId: orgId } });

  const demoKey = "aip_demo_k3y_meridian_voice_2026";
  await db.apiKey.create({
    data: {
      organizationId: orgId,
      name: "Voice Platform — production webhook",
      keyPrefix: demoKey.slice(0, 8),
      hashedKey: createHash("sha256").update(demoKey).digest("hex"),
      scopes: "voice:ingest",
    },
  });

  console.log("Creating AI agents and campaigns…");
  const [naledi, kagiso, zoe] = await Promise.all([
    db.aIAgent.create({
      data: {
        organizationId: orgId, name: "Naledi", externalId: "agent_naledi_01",
        description: "Empathetic early-stage collections voice agent. Leads with affordability options.",
        status: "active", promptRef: "voice-platform://prompts/naledi-v4",
        voiceConfig: JSON.stringify({ voice: "za-female-1", language: "en-ZA", speakingRate: 1.0 }),
      },
    }),
    db.aIAgent.create({
      data: {
        organizationId: orgId, name: "Kagiso", externalId: "agent_kagiso_01",
        description: "Firm-but-fair late-stage agent for aged and pre-legal accounts.",
        status: "active", promptRef: "voice-platform://prompts/kagiso-v2",
        voiceConfig: JSON.stringify({ voice: "za-male-2", language: "en-ZA", speakingRate: 0.97 }),
      },
    }),
    db.aIAgent.create({
      data: {
        organizationId: orgId, name: "Zoe", externalId: "agent_zoe_01",
        description: "Payment-arrangement specialist tuned for medical and high-balance accounts.",
        status: "paused", promptRef: "voice-platform://prompts/zoe-v1",
        voiceConfig: JSON.stringify({ voice: "za-female-3", language: "en-ZA", speakingRate: 1.02 }),
      },
    }),
  ]);

  type CampaignSpec = {
    name: string; description: string; segment: string; agentId: string;
    strategy: string; status: string; creditor: string; prefix: string;
    balance: [number, number]; overdue: [number, number]; debtors: number;
    startDaysAgo: number; endDaysAhead: number | null; historyDays: [number, number];
  };
  const specs: CampaignSpec[] = [
    {
      name: "Retail Arrears — 30-60 Days", creditor: "Edgars Retail Credit", prefix: "EDG",
      description: "Early-stage retail credit accounts between 30 and 60 days overdue.",
      segment: "Retail credit, R500–R8,000, 30–60 days overdue, no prior broken promise",
      agentId: naledi.id, strategy: "payment_plan_first", status: "active",
      balance: [650, 8200], overdue: [30, 60], debtors: 12, startDaysAgo: 38, endDaysAhead: 22, historyDays: [1, 36],
    },
    {
      name: "Telecoms Early-Stage", creditor: "Vodacom SA", prefix: "VOD",
      description: "Suspended contract accounts, first collections cycle.",
      segment: "Telecoms contracts, R300–R4,500, 15–45 days overdue",
      agentId: naledi.id, strategy: "standard", status: "active",
      balance: [340, 4600], overdue: [15, 45], debtors: 11, startDaysAgo: 24, endDaysAhead: 35, historyDays: [1, 22],
    },
    {
      name: "Micro-Loans 90+ Recovery", creditor: "Capfin Micro Loans", prefix: "CAP",
      description: "Aged short-term loan book with early-settlement discount mandate.",
      segment: "Unsecured micro-loans, R2,000–R26,000, 90+ days overdue",
      agentId: kagiso.id, strategy: "early_settlement", status: "active",
      balance: [2100, 26400], overdue: [92, 240], debtors: 10, startDaysAgo: 45, endDaysAhead: 15, historyDays: [2, 42],
    },
    {
      name: "Medical Accounts Q2", creditor: "Netcare Milpark Hospital", prefix: "NMH",
      description: "Hospital accounts handed over after internal follow-up. Completed cycle.",
      segment: "Private medical accounts, R1,500–R60,000, 60–180 days overdue",
      agentId: zoe.id, strategy: "payment_plan_first", status: "completed",
      balance: [1650, 58000], overdue: [60, 180], debtors: 8, startDaysAgo: 92, endDaysAhead: null, historyDays: [30, 80],
    },
    {
      name: "Vehicle Finance Pre-Legal", creditor: "WesBank Vehicle Finance", prefix: "WES",
      description: "High-balance vehicle finance accounts scheduled for a firm-reminder cycle before legal hand-over.",
      segment: "Vehicle finance, R15,000–R120,000, 60–120 days overdue",
      agentId: kagiso.id, strategy: "firm_reminder", status: "scheduled",
      balance: [15500, 122000], overdue: [60, 120], debtors: 6, startDaysAgo: -5, endDaysAhead: 50, historyDays: [0, 0],
    },
  ];

  const usedNames = new Set<string>();
  const usedPhones = new Set<string>();
  let accountSeq = 4100;

  const showcase: { callId: string }[] = [];
  let smsCount = 0;

  for (const spec of specs) {
    const campaign = await db.campaign.create({
      data: {
        organizationId: orgId,
        name: spec.name,
        description: spec.description,
        segment: spec.segment,
        agentId: spec.agentId,
        strategy: spec.strategy,
        status: spec.status,
        startDate: daysAgo(spec.startDaysAgo),
        endDate: spec.endDaysAhead != null ? daysAhead(spec.endDaysAhead) : daysAgo(10),
        callingHoursStart: "09:00",
        callingHoursEnd: spec.strategy === "firm_reminder" ? "19:00" : "18:00",
        maxAttempts: spec.strategy === "early_settlement" ? 8 : 6,
        retryIntervalHours: 48,
      },
    });
    if (spec.status === "active") {
      await db.platformEvent.create({
        data: {
          organizationId: orgId, type: "campaign.started", entityType: "campaign",
          entityId: campaign.id, payload: JSON.stringify({ name: campaign.name }),
          createdAt: daysAgo(spec.startDaysAgo),
        },
      });
    }
    const agent = [naledi, kagiso, zoe].find((a) => a.id === spec.agentId)!;

    for (let i = 0; i < spec.debtors; i++) {
      let first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
      while (usedNames.has(`${first} ${last}`)) {
        first = pick(FIRST_NAMES);
        last = pick(LAST_NAMES);
      }
      usedNames.add(`${first} ${last}`);
      let phone = `+27${pick(["72", "73", "76", "78", "82", "83", "84"])}${int(1000000, 9999999)}`;
      while (usedPhones.has(phone)) phone = `+2782${int(1000000, 9999999)}`;
      usedPhones.add(phone);
      const [city, province] = pick(LOCATIONS);
      const originalBalance = roundTo(between(spec.balance[0], spec.balance[1]), 10);
      const overdueDays = int(spec.overdue[0], spec.overdue[1]);
      const accountNumber = `${spec.prefix}-${accountSeq++}`;

      const debtor = await db.debtor.create({
        data: {
          organizationId: orgId,
          firstName: first,
          lastName: last,
          accountNumber,
          phone,
          email: chance(0.7) ? `${first.toLowerCase().replace(/[^a-z]/g, "")}.${last.toLowerCase().replace(/[^a-z]/g, "")}@gmail.com` : null,
          city,
          province,
          campaignId: campaign.id,
          riskScore: Math.min(95, Math.max(10, Math.round(overdueDays / 3 + between(-10, 25)))),
        },
      });
      const account = await db.debtAccount.create({
        data: {
          organizationId: orgId,
          debtorId: debtor.id,
          reference: `${spec.prefix}/${now.getFullYear()}/${accountSeq}`,
          creditorName: spec.creditor,
          originalBalance,
          currentBalance: originalBalance,
          dueDate: daysAgo(overdueDays),
          daysOverdue: overdueDays,
        },
      });

      // --- call history for this debtor ---
      if (spec.historyDays[1] === 0) continue; // scheduled campaign: no calls yet

      const attempts = int(2, spec.strategy === "early_settlement" ? 8 : 6);
      let attemptDay = int(
        Math.max(spec.historyDays[0], spec.historyDays[1] - 6),
        spec.historyDays[1],
      );
      let lastOutcome: string | null = null;
      let lastContactAt: Date | null = null;
      let terminal = false;
      let totalPaid = 0;
      let debtorStatus = "active";

      for (let a = 0; a < attempts && !terminal && attemptDay >= spec.historyDays[0] - 1; a++) {
        const startedAt = atHour(daysAgo(attemptDay), int(9, 17), int(0, 59));
        attemptDay -= int(2, 4);
        const connected = chance(0.48);

        if (!connected) {
          const status = rand() < 0.72 ? "no_answer" : rand() < 0.7 ? "voicemail" : "busy";
          const durationSeconds = status === "voicemail" ? int(28, 50) : 0;
          const call = await db.call.create({
            data: {
              organizationId: orgId,
              externalCallId: `vcall_${debtor.id.slice(-6)}_${a}`,
              debtorId: debtor.id,
              campaignId: campaign.id,
              agentId: agent.id,
              startedAt,
              endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
              durationSeconds,
              status,
              outcome: "no_answer",
            },
          });
          await db.callAnalysis.create({
            data: {
              organizationId: orgId,
              callId: call.id,
              createdAt: new Date(startedAt.getTime() + 30_000),
              outcome: "no_answer",
              sentiment: "neutral",
              sentimentScore: 0,
              nextAction: "retry_within_campaign_rules",
              summary: `Call attempt to ${first} ${last} was not answered${status === "voicemail" ? "; voicemail reached" : ""}.`,
              keyPoints: JSON.stringify(["No contact made", "Retry scheduled within campaign rules"]),
            },
          });
          lastOutcome = "no_answer";
          lastContactAt = startedAt;
          continue;
        }

        const outcome = pickOutcome();
        const isCommitment = outcome === "promise_to_pay" || outcome === "payment_arrangement";
        const installments = outcome === "payment_arrangement" ? pick([2, 3, 4, 6]) : null;
        const promisedAmount = isCommitment
          ? roundTo(originalBalance * (outcome === "promise_to_pay" ? between(0.25, 1.0) : between(0.85, 1.0)), 50)
          : null;
        const promisedDate = isCommitment
          ? atHour(new Date(startedAt.getTime() + int(3, 10) * 86_400_000), 12, 0)
          : null;
        const durationSeconds = int(110, 430);
        const negativeOutcome = ["refused_to_pay", "opted_out", "dispute"].includes(outcome);

        const call = await db.call.create({
          data: {
            organizationId: orgId,
            externalCallId: `vcall_${debtor.id.slice(-6)}_${a}`,
            debtorId: debtor.id,
            campaignId: campaign.id,
            agentId: agent.id,
            startedAt,
            endedAt: new Date(startedAt.getTime() + durationSeconds * 1000),
            durationSeconds,
            status: "completed",
            outcome,
            transcript: transcript(agent.name, first, spec.creditor, originalBalance, outcome, promisedAmount, promisedDate, installments),
            recordingUrl: `https://voice.example-platform.io/recordings/vcall_${debtor.id.slice(-6)}_${a}.mp3`,
          },
        });
        const requiresHuman = ["dispute", "financial_hardship"].includes(outcome) || (outcome === "refused_to_pay" && chance(0.4));
        await db.callAnalysis.create({
          data: {
            organizationId: orgId,
            callId: call.id,
            createdAt: new Date(startedAt.getTime() + 30_000),
            outcome,
            promisedAmount,
            promisedDate,
            paymentPlan: installments && promisedAmount
              ? JSON.stringify({ installments, amount_per_installment: Math.round(promisedAmount / installments), frequency: "monthly" })
              : null,
            reasonForNonpayment: NONPAYMENT_REASON[outcome] ?? null,
            sentiment: negativeOutcome ? "negative" : isCommitment ? (chance(0.5) ? "positive" : "neutral") : "neutral",
            sentimentScore: negativeOutcome ? -between(0.4, 0.9) : isCommitment ? between(0.1, 0.7) : between(-0.15, 0.2),
            requiresHuman,
            escalationReason: requiresHuman
              ? outcome === "dispute" ? "dispute" : outcome === "financial_hardship" ? "financial_hardship" : "angry_customer"
              : null,
            nextAction:
              outcome === "promise_to_pay" ? "follow_up_before_promised_date"
              : outcome === "payment_arrangement" ? "confirm_first_installment"
              : outcome === "dispute" ? "route_to_dispute_handler"
              : outcome === "financial_hardship" ? "human_affordability_review"
              : outcome === "callback_requested" ? "schedule_callback"
              : outcome === "opted_out" ? "suppress_contact"
              : outcome === "wrong_number" ? "verify_contact_details"
              : outcome === "paid_in_full_claimed" ? "verify_payment_received"
              : "retry_with_alternative_approach",
            summary: SUMMARIES[outcome](
              `${first} ${last}`,
              promisedAmount ? `R${Math.round(promisedAmount).toLocaleString("en-ZA")}` : "",
              promisedDate ? longDate(promisedDate) : "",
            ),
            keyPoints: JSON.stringify([
              ...(promisedAmount ? [`Committed to R${Math.round(promisedAmount).toLocaleString("en-ZA")}${promisedDate ? ` by ${longDate(promisedDate)}` : ""}`] : []),
              ...(NONPAYMENT_REASON[outcome] ? [`Reason for non-payment: ${NONPAYMENT_REASON[outcome].replace(/_/g, " ")}`] : []),
              ...(requiresHuman ? ["Flagged for human review"] : []),
              ...(promisedAmount || requiresHuman ? [] : ["No firm commitment obtained"]),
            ]),
          },
        });
        showcase.push({ callId: call.id });

        await db.platformEvent.createMany({
          data: [
            {
              organizationId: orgId, type: "call.completed", entityType: "call", entityId: call.id,
              payload: JSON.stringify({ debtorId: debtor.id, status: "completed" }), createdAt: startedAt,
            },
            {
              organizationId: orgId, type: "call.analysed", entityType: "call", entityId: call.id,
              payload: JSON.stringify({ outcome }), createdAt: new Date(startedAt.getTime() + 30_000),
            },
          ],
        });

        lastOutcome = outcome;
        lastContactAt = startedAt;

        // Promise + downstream payment behaviour.
        if (isCommitment && promisedAmount && promisedDate) {
          const resolvedByNow = promisedDate.getTime() < now.getTime() - 3 * 86_400_000;
          const willFulfil = chance(0.58);
          const status = resolvedByNow ? (willFulfil ? "fulfilled" : "broken") : "pending";
          const promise = await db.promiseToPay.create({
            data: {
              organizationId: orgId,
              debtorId: debtor.id,
              campaignId: campaign.id,
              callId: call.id,
              amount: promisedAmount,
              promisedDate,
              paymentPlan: installments
                ? JSON.stringify({ installments, amount_per_installment: Math.round(promisedAmount / installments), frequency: "monthly" })
                : null,
              status,
              fulfilledAt: status === "fulfilled" ? promisedDate : null,
              createdAt: startedAt,
            },
          });
          await db.platformEvent.create({
            data: {
              organizationId: orgId, type: "promise.created", entityType: "promise", entityId: promise.id,
              payload: JSON.stringify({ debtorId: debtor.id, amount: promisedAmount }), createdAt: startedAt,
            },
          });
          if (status === "fulfilled") {
            const payAmount = installments ? Math.round(promisedAmount / installments) : promisedAmount;
            const paidAt = atHour(new Date(promisedDate.getTime() - int(0, 1) * 86_400_000), int(8, 19), int(0, 59));
            const payment = await db.payment.create({
              data: {
                organizationId: orgId,
                debtorId: debtor.id,
                debtAccountId: account.id,
                campaignId: campaign.id,
                promiseId: promise.id,
                amount: installments ? payAmount : promisedAmount,
                paidAt,
                method: pick(["eft", "eft", "debit_order", "card", "payment_link", "cash_deposit"]),
                reference: `${spec.prefix}${int(100000, 999999)}`,
              },
            });
            totalPaid += payment.amount;
            // For single-payment promises the promise is settled; for plans the
            // first installment landed and the plan continues.
            if (installments && installments > 1) {
              await db.promiseToPay.update({ where: { id: promise.id }, data: { status: "pending", fulfilledAt: null, promisedDate: daysAhead(int(5, 25)) } });
            }
            await db.platformEvent.createMany({
              data: [
                {
                  organizationId: orgId, type: "payment.received", entityType: "payment", entityId: payment.id,
                  payload: JSON.stringify({ debtorId: debtor.id, amount: payment.amount }), createdAt: paidAt,
                },
                ...(!installments
                  ? [{
                      organizationId: orgId, type: "promise.fulfilled", entityType: "promise", entityId: promise.id,
                      payload: JSON.stringify({ debtorId: debtor.id, amount: promisedAmount }), createdAt: paidAt,
                    }]
                  : []),
              ],
            });
          } else if (status === "broken") {
            await db.platformEvent.create({
              data: {
                organizationId: orgId, type: "promise.broken", entityType: "promise", entityId: promise.id,
                payload: JSON.stringify({ debtorId: debtor.id, amount: promisedAmount }),
                createdAt: new Date(promisedDate.getTime() + 2 * 86_400_000),
              },
            });
          }
          debtorStatus = status === "broken" ? "active" : outcome === "promise_to_pay" ? "promise" : "arrangement";
          terminal = chance(0.85);
        }

        if (["dispute", "financial_hardship"].includes(outcome) || requiresHuman) {
          const reason = outcome === "dispute" ? "dispute" : outcome === "financial_hardship" ? "financial_hardship" : "angry_customer";
          const escStatusRoll = rand();
          const escStatus = escStatusRoll < 0.35 ? "open" : escStatusRoll < 0.55 ? "in_review" : escStatusRoll < 0.8 ? "assigned" : "resolved";
          const escalation = await db.escalation.create({
            data: {
              organizationId: orgId,
              debtorId: debtor.id,
              callId: call.id,
              campaignId: campaign.id,
              reason,
              priority: reason === "dispute" ? "high" : reason === "financial_hardship" ? "medium" : "high",
              status: escStatus,
              assignedToUserId: ["assigned", "resolved"].includes(escStatus) ? pick(collectors).id : null,
              notes: SUMMARIES[outcome](`${first} ${last}`, "", ""),
              resolutionNotes: escStatus === "resolved" ? "Reviewed with the creditor and resolved with the customer by phone." : null,
              createdAt: startedAt,
              resolvedAt: escStatus === "resolved" ? new Date(startedAt.getTime() + int(2, 6) * 86_400_000) : null,
            },
          });
          await db.platformEvent.create({
            data: {
              organizationId: orgId, type: "debtor.escalated", entityType: "escalation", entityId: escalation.id,
              payload: JSON.stringify({ debtorId: debtor.id, reason }), createdAt: startedAt,
            },
          });
          debtorStatus = "escalated";
          terminal = true;
        }
        if (outcome === "opted_out") {
          debtorStatus = "opted_out";
          terminal = true;
        }
        if (outcome === "refused_to_pay" && !requiresHuman) debtorStatus = "active";
        if (outcome === "paid_in_full_claimed") debtorStatus = "dispute";
      }

      // Occasional ad-hoc payment without a promise (debtor paid after an SMS).
      if (!totalPaid && chance(0.22)) {
        const payAmount = roundTo(originalBalance * between(0.15, 0.6), 50);
        const paidAt = atHour(daysAgo(int(1, 20)), int(8, 20), int(0, 59));
        await db.payment.create({
          data: {
            organizationId: orgId, debtorId: debtor.id, debtAccountId: account.id,
            campaignId: campaign.id, amount: payAmount, paidAt,
            method: pick(["eft", "payment_link", "cash_deposit"]),
            reference: `${spec.prefix}${int(100000, 999999)}`,
          },
        });
        totalPaid += payAmount;
      }

      // SMS touches for the timeline.
      if (chance(0.4)) {
        smsCount++;
        await db.platformEvent.create({
          data: {
            organizationId: orgId, type: "sms.sent", entityType: "debtor", entityId: debtor.id,
            payload: JSON.stringify({ template: "payment_reminder", channel: "sms" }),
            createdAt: atHour(daysAgo(int(1, 25)), int(9, 17), int(0, 59)),
          },
        });
      }

      const newBalance = Math.max(0, originalBalance - totalPaid);
      await db.debtAccount.update({
        where: { id: account.id },
        data: { currentBalance: newBalance, amountPaid: totalPaid },
      });
      await db.debtor.update({
        where: { id: debtor.id },
        data: {
          status: newBalance <= 0 ? "paid" : debtorStatus,
          lastOutcome,
          lastContactAt,
          doNotContact: debtorStatus === "opted_out",
          riskScore: Math.max(5, Math.min(95, Math.round(
            overdueDays / 3
            + (debtorStatus === "promise" || debtorStatus === "arrangement" ? -15 : 0)
            + (lastOutcome === "refused_to_pay" ? 20 : 0)
            + (newBalance <= 0 ? -40 : 0)
            + between(-5, 10),
          ))),
        },
      });
    }
  }

  console.log("Generating AI insights and reports from the seeded data…");
  const snapshot30 = await buildCollectionSnapshot(orgId, {
    periodStart: daysAgo(30),
    periodEnd: new Date(), // fresh timestamp — after all inserts above
  });
  const insights = await mockProvider.generateCollectionInsights(snapshot30);
  await db.aIInsight.createMany({
    data: [
      {
        organizationId: orgId, scope: "dashboard", content: JSON.stringify(insights),
        provider: "mock", dataWindowStart: daysAgo(30), dataWindowEnd: now, generatedAt: daysAgo(0),
      },
      {
        organizationId: orgId, scope: "insights", content: JSON.stringify(insights),
        provider: "mock", dataWindowStart: daysAgo(30), dataWindowEnd: now, generatedAt: daysAgo(0),
      },
    ],
  });

  const reportSpecs: { type: string; periodDays: number }[] = [
    { type: "executive_summary", periodDays: 30 },
    { type: "weekly", periodDays: 7 },
    { type: "daily", periodDays: 1 },
    { type: "ptp", periodDays: 30 },
    { type: "recovery", periodDays: 30 },
  ];
  for (const spec of reportSpecs) {
    const snap = spec.periodDays === 30 ? snapshot30 : await buildCollectionSnapshot(orgId, {
      periodStart: daysAgo(spec.periodDays),
      periodEnd: new Date(),
    });
    const narrative = await mockProvider.generateReportNarrative(spec.type, snap);
    await db.report.create({
      data: {
        organizationId: orgId,
        type: spec.type,
        title: `${
          { executive_summary: "Executive Summary", weekly: "Weekly Collection Report", daily: "Daily Collection Report", ptp: "Promise-to-Pay Report", recovery: "Recovery Report" }[spec.type]
        } — ${now.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`,
        periodStart: daysAgo(spec.periodDays),
        periodEnd: now,
        status: "ready",
        content: JSON.stringify({ narrative, snapshot: snap }),
        provider: "mock",
        generatedAt: now,
      },
    });
  }

  const counts = {
    debtors: await db.debtor.count(),
    calls: await db.call.count(),
    promises: await db.promiseToPay.count(),
    payments: await db.payment.count(),
    escalations: await db.escalation.count(),
    reports: await db.report.count(),
    events: await db.platformEvent.count(),
  };
  console.log("Seed complete:", counts, `sms events: ${smsCount}`);
  console.log("\nDemo voice-integration API key (also documented in README):");
  console.log(`  ${demoKey}`);
  console.log("Use it as: Authorization: Bearer <key> on POST /api/integrations/voice/call-completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
