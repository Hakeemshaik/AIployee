// Generates fixtures/demo-campaign.json — ~120 fake accounts with realistic
// South African name/unit/building/balance shapes and a spread of outcomes.
// Deterministic, so the demo dataset is stable across runs.
import { writeFileSync, mkdirSync } from "node:fs";

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260825);
const pick = (a) => a[Math.floor(rand() * a.length)];
const int = (lo, hi) => Math.floor(lo + rand() * (hi - lo + 1));
const chance = (p) => rand() < p;

const FIRST = ["Sipho","Thandi","Lerato","Bongani","Nomvula","Kagiso","Ayanda","Pieter","Annelie","Johan","Marike","Riaan","Charmaine","Kevin","Priya","Rajesh","Fatima","Yusuf","Naledi","Tumelo","Zanele","Mandla","Precious","Karabo","Dineo","Xolani","Andile","Nonhlanhla","Themba","Busisiwe"];
const LAST = ["Nkosi","Dlamini","Mokoena","van der Merwe","Botha","Naidoo","Pillay","Khumalo","Mahlangu","Sithole","Pretorius","Jacobs","Fourie","Ndlovu","Mthembu","Petersen","Adams","Ismail","Molefe","Radebe","Sibiya","Cele","du Plessis","Venter","Maharaj"];
const BUILDINGS = ["Waterkloof Heights","Sandton Mews","Rosebank Place","Bryanston Villas","Melrose Arch North","Parktown Court","Killarney Gardens","Norwood Terrace"];

const TENANT_LINES = {
  conversation: [
    "Yes speaking. I know about the arrears, things have been tight but I can pay fifteen hundred rand on the twenty fifth.",
    "Yes that is me. I can do two thousand this Friday and the rest at month end if that works.",
    "I have been meaning to call you. I can settle three thousand rand next week Wednesday.",
    "Look I lost my job in June so I honestly cannot afford the full amount right now, maybe five hundred a month.",
    "This is not my account. I moved out of that unit last year and I dispute the whole balance.",
  ],
  few: ["yes okay", "call me later", "not now", "wrong number sorry"],
  machine: ["The subscriber you have dialled is not available", "Please leave a message after the tone", "mailbox is full"],
};

const accounts = [];
const conversations = [];
const transcripts = {};
let convSeq = 1_300_000;

const campaignStart = "2026-08-17T06:00:00.000Z";

for (let i = 0; i < 120; i++) {
  const first = pick(FIRST), last = pick(LAST);
  const phone = `+2782${String(int(1000000, 9999999))}`;
  const balance = Math.round(int(480, 42_000) / 10) * 10;
  const accountId = `ACC-${5000 + i}`;

  // Bucket mix roughly matching live campaigns.
  const roll = rand();
  const kind = roll < 0.30 ? "conversation" : roll < 0.40 ? "few" : roll < 0.62 ? "connected" : roll < 0.90 ? "dead" : "uncalled";

  const attempts = kind === "uncalled" ? 0 : int(1, kind === "dead" ? 4 : 3);
  const calls = [];
  for (let a = 0; a < attempts; a++) {
    const uuid = `conv-${convSeq++}`;
    const day = 17 + Math.min(6, a * 2);
    const hour = pick([7, 9, 11, 13, 15, 17]); // UTC — 9,11,13,15,17,19 SAST
    const isLast = a === attempts - 1;
    let duration = 0, turns = [];

    if (kind === "conversation" && isLast) {
      duration = int(70, 260);
      const line = pick(TENANT_LINES.conversation);
      turns = [
        { role: "assistant", text: "Good day, this call is recorded for quality and compliance purposes. Am I speaking to the account holder?" },
        { role: "user", text: line },
        { role: "assistant", text: "Thank you, I have noted that and will send the payment details by SMS." },
      ];
    } else if (kind === "few" && isLast) {
      duration = int(8, 25);
      turns = [
        { role: "assistant", text: "Good day, this call is recorded. Am I speaking to the account holder?" },
        { role: "user", text: pick(TENANT_LINES.few) },
      ];
    } else if (kind === "connected") {
      duration = int(4, 18);
      turns = [{ role: "user", text: pick(TENANT_LINES.machine) }];
    } else {
      duration = 0;
      turns = [];
    }

    calls.push({ uuid, startedAt: `2026-08-${day}T${String(hour).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}:00.000Z`, durationSeconds: duration });
    conversations.push({
      uuid, phone, contactName: `${first} ${last}`, durationSeconds: duration,
      agentName: "Siya 1st call MPM", flowName: "MPM Main",
      voicemailFlag: chance(0.25),  // deliberately unreliable, as in production
      createdAt: calls[calls.length - 1].startedAt,
    });
    transcripts[uuid] = turns;
  }

  const committed = kind === "conversation" && chance(0.55);
  const statedAmount = committed ? (chance(0.7) ? Math.round(int(300, Math.max(400, Math.floor(balance * 0.8))) / 50) * 50 : null) : null;

  accounts.push({
    accountId, name: `${first} ${last}`, phone,
    unit: chance(0.85) ? `${pick(["A","B","C","D"])}${int(1, 24)}` : null,
    building: pick(BUILDINGS),
    balance,
    calls,
    outcome: {
      ptpConfirmed: committed,
      ptpAmount: statedAmount,
      disputed: kind === "conversation" && chance(0.08),
      paidClaimed: chance(0.04),
      escalated: chance(0.05),
      doNotCall: chance(0.02),
    },
  });
}

const fixture = {
  meta: {
    campaignName: "Waterkloof Collections — August",
    workspace: "DEMO (fixture data)",
    campaignStart,
    generated: "deterministic fixture, no live accounts",
    accountCount: accounts.length,
  },
  accounts, conversations, transcripts,
};

mkdirSync("src/fixtures", { recursive: true });
writeFileSync("src/fixtures/demo-campaign.json", JSON.stringify(fixture, null, 2));
console.log(`fixture written: ${accounts.length} accounts, ${conversations.length} conversations`);
