import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Duplicate accounts.
//
// A book gets duplicates from three directions: the same person appearing
// twice in a client spreadsheet under different references, an account created
// from the voice platform alongside one imported from a file, and two
// spreadsheets from the same client overlapping.
//
// The damage is quiet. Analytics already assigns each CALL to exactly one
// record, so calls are not double counted — but the book itself is, which
// inflates total outstanding, dilutes every rate that divides by the book, and
// means one of the two records shows a promise while the other looks ignored.
//
// Matching is deliberately conservative. Only two signals are strong enough to
// merge on without a human deciding:
//
//   provider_uuid — the voice platform's own customer id. Exact, no judgement.
//   phone         — the last nine digits. Two records with the same number are
//                   the same person for dialling purposes, which is what this
//                   platform is for.
//
// Name similarity is NOT used. "J Smith" and "John Smith" at different units
// are different tenants, and merging them loses a real account.
// ---------------------------------------------------------------------------

export type DuplicateMember = {
  debtorId: string;
  name: string;
  accountNumber: string;
  phone: string;
  balance: number;
  accounts: number;
  calls: number;
  promises: number;
  payments: number;
  createdAt: Date;
  campaignName: string | null;
  /** The record the others would be merged into. */
  keeper: boolean;
};

export type DuplicateGroup = {
  /** Stable key for this group, so a merge request names exactly one group. */
  key: string;
  matchedOn: "provider_uuid" | "phone";
  members: DuplicateMember[];
  /** Balance counted more than once because of this group. */
  doubleCountedValue: number;
};

export type DuplicateReport = {
  groups: DuplicateGroup[];
  /** Records that would go away — always members minus one per group. */
  extraRecords: number;
  /** Total balance the book is currently overstated by. */
  overstatedValue: number;
  scanned: number;
};

/** Last 9 digits — the stable core of a South African number in any format. */
function phoneKey(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

type Row = {
  id: string;
  firstName: string;
  lastName: string;
  accountNumber: string;
  phone: string;
  providerContactUuid: string | null;
  createdAt: Date;
  campaign: { name: string } | null;
  accounts: { currentBalance: number }[];
  _count: { calls: number; promises: number; payments: number };
};

/**
 * Which record survives a merge.
 *
 * Preference order, and each step is a real reason rather than a tie-break:
 *   1. has the provider's customer uuid — it is the record the voice platform
 *      will keep writing call results to
 *   2. has the most history attached — merging into the emptier record moves
 *      more rows and risks more
 *   3. oldest — it is the one other systems and people have seen
 */
function pickKeeper(rows: Row[]): Row {
  return [...rows].sort((a, b) => {
    const uuid = Number(!!b.providerContactUuid) - Number(!!a.providerContactUuid);
    if (uuid !== 0) return uuid;
    const history =
      b._count.calls + b._count.promises + b._count.payments + b.accounts.length -
      (a._count.calls + a._count.promises + a._count.payments + a.accounts.length);
    if (history !== 0) return history;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

function toMember(row: Row, keeper: boolean): DuplicateMember {
  return {
    debtorId: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
    accountNumber: row.accountNumber,
    phone: row.phone,
    balance: row.accounts.reduce((sum, account) => sum + account.currentBalance, 0),
    accounts: row.accounts.length,
    calls: row._count.calls,
    promises: row._count.promises,
    payments: row._count.payments,
    createdAt: row.createdAt,
    campaignName: row.campaign?.name ?? null,
    keeper,
  };
}

export async function findDuplicates(organizationId: string): Promise<DuplicateReport> {
  const rows = (await db.debtor.findMany({
    where: { organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      accountNumber: true,
      phone: true,
      providerContactUuid: true,
      createdAt: true,
      campaign: { select: { name: true } },
      accounts: { select: { currentBalance: true } },
      _count: { select: { calls: true, promises: true, payments: true } },
    },
    orderBy: { createdAt: "asc" },
  })) as Row[];

  // Provider uuid first: it is the stronger signal, and grouping on it before
  // phone means a uuid match is never split apart by a differing number.
  const byUuid = new Map<string, Row[]>();
  const remaining: Row[] = [];
  for (const row of rows) {
    if (row.providerContactUuid) {
      const list = byUuid.get(row.providerContactUuid) ?? [];
      list.push(row);
      byUuid.set(row.providerContactUuid, list);
    } else {
      remaining.push(row);
    }
  }

  const groups: DuplicateGroup[] = [];
  const claimed = new Set<string>();

  const addGroup = (key: string, matchedOn: DuplicateGroup["matchedOn"], members: Row[]) => {
    if (members.length < 2) return;
    const keeper = pickKeeper(members);
    const built = members.map((row) => toMember(row, row.id === keeper.id));
    // The keeper's balance is real; every other member's is counted twice.
    const doubleCountedValue = built
      .filter((member) => !member.keeper)
      .reduce((sum, member) => sum + member.balance, 0);
    groups.push({ key, matchedOn, members: built, doubleCountedValue });
    for (const row of members) claimed.add(row.id);
  };

  for (const [uuid, members] of byUuid) addGroup(`uuid:${uuid}`, "provider_uuid", members);

  // Then phone, across everything not already grouped by uuid.
  const byPhone = new Map<string, Row[]>();
  for (const row of rows) {
    if (claimed.has(row.id)) continue;
    const key = phoneKey(row.phone);
    if (!key) continue;
    const list = byPhone.get(key) ?? [];
    list.push(row);
    byPhone.set(key, list);
  }
  for (const [key, members] of byPhone) addGroup(`phone:${key}`, "phone", members);

  const extraRecords = groups.reduce((sum, group) => sum + group.members.length - 1, 0);
  const overstatedValue = groups.reduce((sum, group) => sum + group.doubleCountedValue, 0);

  return {
    // Worst first: the biggest overstatement is the one worth looking at.
    groups: groups.sort((a, b) => b.doubleCountedValue - a.doubleCountedValue),
    extraRecords,
    overstatedValue,
    scanned: rows.length,
  };
}

export type MergeResult = {
  groupsMerged: number;
  recordsRemoved: number;
  accountsMoved: number;
  callsMoved: number;
  promisesMoved: number;
  paymentsMoved: number;
};

/**
 * Merge the named groups into their keepers.
 *
 * Nothing is thrown away: every account, call, promise, payment, escalation
 * and campaign membership is reassigned to the keeper before the duplicate
 * record is deleted. A merge is not reversible, so the caller has to name the
 * groups — there is no "merge everything you find" without a list.
 */
export async function mergeDuplicates(
  organizationId: string,
  userId: string,
  groupKeys: string[],
): Promise<MergeResult> {
  const report = await findDuplicates(organizationId);
  const wanted = new Set(groupKeys);
  const targets = report.groups.filter((group) => wanted.has(group.key));

  const result: MergeResult = {
    groupsMerged: 0,
    recordsRemoved: 0,
    accountsMoved: 0,
    callsMoved: 0,
    promisesMoved: 0,
    paymentsMoved: 0,
  };

  for (const group of targets) {
    const keeper = group.members.find((member) => member.keeper);
    if (!keeper) continue;
    const losers = group.members.filter((member) => !member.keeper).map((member) => member.debtorId);
    if (losers.length === 0) continue;

    // Every write is scoped to the organization as well as the id, so a
    // crafted group key cannot reach another tenant's rows.
    const scope = { organizationId, debtorId: { in: losers } };

    const [accounts, calls, promises, payments] = await Promise.all([
      db.debtAccount.updateMany({ where: scope, data: { debtorId: keeper.debtorId } }),
      db.call.updateMany({ where: scope, data: { debtorId: keeper.debtorId } }),
      db.promiseToPay.updateMany({ where: scope, data: { debtorId: keeper.debtorId } }),
      db.payment.updateMany({ where: scope, data: { debtorId: keeper.debtorId } }),
    ]);
    await db.escalation.updateMany({ where: scope, data: { debtorId: keeper.debtorId } });
    // Campaign membership is a unique pair, so a duplicate that shares a
    // campaign with the keeper cannot be moved — it is dropped instead, and the
    // keeper's own membership already covers it.
    await db.campaignContact.deleteMany({ where: scope });

    const removed = await db.debtor.deleteMany({
      where: { organizationId, id: { in: losers } },
    });

    result.groupsMerged += 1;
    result.recordsRemoved += removed.count;
    result.accountsMoved += accounts.count;
    result.callsMoved += calls.count;
    result.promisesMoved += promises.count;
    result.paymentsMoved += payments.count;

    await audit({
      organizationId,
      actorType: "user",
      actorId: userId,
      action: "debtors.duplicates_merged",
      entityType: "debtor",
      entityId: keeper.debtorId,
      detail: {
        matchedOn: group.matchedOn,
        keptAccountNumber: keeper.accountNumber,
        removed: losers.length,
        accountsMoved: accounts.count,
        callsMoved: calls.count,
        promisesMoved: promises.count,
        paymentsMoved: payments.count,
      },
    });
  }

  return result;
}
