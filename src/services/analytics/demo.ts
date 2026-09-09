import fixture from "@/fixtures/demo-campaign.json";
import {
  classifyCampaign,
  summariseTranscript,
  type ClassifiableAccount,
  type ClassifiedResult,
} from "./classify";

// ---------------------------------------------------------------------------
// Guest/demo dataset.
//
// The fixture is deterministic and contains no live accounts. It runs through
// exactly the same classification engine as real data, so the demo cannot
// drift from production behaviour.
// ---------------------------------------------------------------------------

type FixtureAccount = {
  accountId: string;
  name: string;
  phone: string;
  unit: string | null;
  building: string;
  balance: number;
  calls: { uuid: string; startedAt: string; durationSeconds: number }[];
  outcome: {
    ptpConfirmed: boolean;
    ptpAmount: number | null;
    disputed: boolean;
    paidClaimed: boolean;
    escalated: boolean;
    doNotCall: boolean;
  };
};

type Fixture = {
  meta: { campaignName: string; workspace: string; campaignStart: string; accountCount: number };
  accounts: FixtureAccount[];
  conversations: { uuid: string; phone: string; agentName: string; flowName: string; voicemailFlag: boolean }[];
  transcripts: Record<string, { role: string; text: string }[]>;
};

const data = fixture as unknown as Fixture;

export type DemoAccountRow = {
  accountId: string;
  name: string;
  phone: string;
  unit: string | null;
  building: string;
  balance: number;
  outcome: FixtureAccount["outcome"];
};

export function demoMeta() {
  return data.meta;
}

export function demoAccountRows(): DemoAccountRow[] {
  return data.accounts.map((a) => ({
    accountId: a.accountId,
    name: a.name,
    phone: a.phone,
    unit: a.unit,
    building: a.building,
    balance: a.balance,
    outcome: a.outcome,
  }));
}

export function demoTranscript(conversationUuid: string) {
  return data.transcripts[conversationUuid] ?? [];
}

export function demoCallHistory(accountId: string) {
  const account = data.accounts.find((a) => a.accountId === accountId);
  if (!account) return [];
  return account.calls.map((call) => ({
    ...call,
    startedAt: new Date(call.startedAt),
    turns: data.transcripts[call.uuid] ?? [],
  }));
}

/** Build classifiable accounts from the fixture, transcripts included. */
export function demoClassifiableAccounts(): ClassifiableAccount[] {
  return data.accounts.map((a) => ({
    accountId: a.accountId,
    phone: a.phone,
    balance: a.balance,
    outcome: a.outcome,
    calls: a.calls.map((call) => {
      const turns = data.transcripts[call.uuid] ?? [];
      return {
        conversationUuid: call.uuid,
        durationSeconds: call.durationSeconds,
        startedAt: new Date(call.startedAt),
        transcript: turns.length > 0 ? summariseTranscript(call.uuid, turns) : null,
      };
    }),
  }));
}

export function demoAnalytics(): ClassifiedResult {
  return classifyCampaign(demoClassifiableAccounts());
}
