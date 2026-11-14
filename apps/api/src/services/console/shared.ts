// Pieces the console files share: loading an MFI's groups and turning them
// into what the console shows. Every query stays inside the officer's own MFI.

import type { ConsoleGroup, GroupWatch } from "@novi/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { currentRoundNumber, isoDay } from "../../lib/schedule.js";
import { nextRetryAt } from "../payoutService.js";
import { reserveBalance } from "../reserveService.js";

// Everything the MFI console reads and does. Each query is limited to the
// officer's MFI. Only totals leave this file (D33, D53), except a member's
// record when she agreed to share it (D84).

// Groups appear once they have reached the MFI: from STARTING, when Novi
// asks it to open the account. Drafts and cancelled groups are not its business.
export const VISIBLE_STATES = ["STARTING", "ACTIVE", "COMPLETED"] as const;

export const withRounds = {
  rulesVersions: true,
  reserveReturns: true,
  rounds: {
    orderBy: { number: "asc" },
    include: { contributions: { where: { status: "PAID" } }, payout: true },
  },
} satisfies Prisma.GroupInclude;

type LoadedGroup = Prisma.GroupGetPayload<{ include: typeof withRounds }>;

function sumPaid(round: LoadedGroup["rounds"][number]) {
  return round.contributions.reduce((total, c) => total + c.amountFcfa, 0);
}

export function rulesOf(
  group: Pick<LoadedGroup, "id" | "currentVersion" | "rulesVersions">,
) {
  const rules = group.rulesVersions.find(
    (r) => r.version === group.currentVersion,
  );
  if (!rules)
    throw new Error(
      `group ${group.id} has no rules version ${group.currentVersion}`,
    );
  return rules;
}

export function toConsoleGroup(group: LoadedGroup): ConsoleGroup {
  const rules = rulesOf(group);
  // Money in and out comes from the rounds' own rows, which match the ledger
  // line for line (D45, D49): one PAID contribution, one CONTRIBUTION line.
  const collectedFcfa = group.rounds.reduce(
    (total, r) => total + sumPaid(r),
    0,
  );
  const paidOutFcfa = group.rounds.reduce(
    (total, r) =>
      total + (r.payout?.status === "PAID" ? r.payout.amountFcfa : 0),
    0,
  );
  // D68: the reserve, and what it already gave back at the end of a cycle.
  const returnedFcfa = group.reserveReturns.reduce(
    (total, r) => total + r.amountFcfa,
    0,
  );
  // Everything the officer must act on in this group: a pot held, failed,
  // ready to release, or one its member says did not arrive (D63).
  const needsAttention = group.rounds.filter(
    (r) =>
      r.payout?.status === "HELD" ||
      r.payout?.status === "FAILED" ||
      r.payout?.status === "READY" ||
      (r.payout?.status === "PAID" && r.payout.receiptDisputedAt !== null),
  ).length;
  // D92: the pots that actually left, for the ring on the overview.
  const potsPaid = group.rounds.filter((r) => r.payout?.status === "PAID").length;
  return {
    id: group.id,
    name: group.name,
    state: group.state as ConsoleGroup["state"],
    accountRef: group.mfiAccountRef,
    amountFcfa: rules.amountFcfa,
    frequency: rules.frequency,
    size: rules.size,
    startedAt: group.startedAt?.toISOString() ?? null,
    currentRound:
      group.state === "ACTIVE" && group.rounds.length > 0
        ? currentRoundNumber(
            group.rounds.map((r) => r.dueDate),
            new Date(),
          )
        : null,
    rounds: group.rounds.length,
    collectedFcfa,
    paidOutFcfa,
    potsPaid,
    balanceFcfa: collectedFcfa - paidOutFcfa - returnedFcfa,
    reserveFcfa: 0, // filled in by withReserve (D68)
    needsAttention,
    // D116: filled in by withHealth.
    health: null,
    watch: null,
    onTimePct: onTimePct(group, rules.size),
    nextPotDate: isoDayOrNull(group.rounds.find((r) => r.payout?.status !== "PAID")?.dueDate),
  };
}

const isoDayOrNull = (d: Date | undefined) => (d ? isoDay(d) : null);

// D116: payments made by the end of their due day (Lomé is on GMT), out of
// all those expected in rounds already due. Null before the first due date.
export function onTimePct(group: LoadedGroup, size: number): number | null {
  const today = isoDay(new Date());
  const due = group.rounds.filter((r) => isoDay(r.dueDate) < today);
  if (due.length === 0 || size === 0) return null;
  const onTime = due.reduce(
    (n, r) => n + r.contributions.filter((c) => c.paidAt && isoDay(c.paidAt) <= isoDay(r.dueDate)).length,
    0,
  );
  return Math.round((100 * onTime) / (due.length * size));
}

// D116: the group's colour and its main reason, from what is open in it now.
// Red: something only a person can settle, or a member in default. Amber:
// something Novi or the member is settling, to keep an eye on. Green: nothing.
export async function withHealth(mfiId: string, groups: ConsoleGroup[]): Promise<ConsoleGroup[]> {
  const ids = groups.filter((g) => g.state === "ACTIVE").map((g) => g.id);
  if (ids.length === 0) return groups;
  const [covers, payouts, reported] = await Promise.all([
    prisma.reserveCover.findMany({
      where: { writtenOffAt: null, round: { groupId: { in: ids } } },
      select: { userId: true, repaidAt: true, missedAt: true, dueBy: true, round: { select: { groupId: true } } },
    }),
    prisma.payout.findMany({
      where: {
        round: { groupId: { in: ids } },
        OR: [{ status: { in: ["HELD", "FAILED"] } }, { status: "PAID", receiptDisputedAt: { not: null } }],
      },
      select: { status: true, attempts: true, failedAt: true, round: { select: { groupId: true } } },
    }),
    prisma.contribution.groupBy({
      by: ["roundId"],
      where: { reportedAt: { not: null }, escalatedAt: { not: null }, status: { not: "PAID" }, round: { groupId: { in: ids } } },
      _count: true,
    }),
  ]);
  const reportedRounds = reported.length
    ? await prisma.round.findMany({ where: { id: { in: reported.map((r) => r.roundId) } }, select: { id: true, groupId: true } })
    : [];
  const reportedIn = (groupId: string) =>
    reported
      .filter((r) => reportedRounds.find((x) => x.id === r.roundId)?.groupId === groupId)
      .reduce((n, r) => n + r._count, 0);

  return groups.map((g) => {
    if (g.state !== "ACTIVE") return g;
    const mine = covers.filter((c) => c.round.groupId === g.id);
    const missedBy = new Map<string, number>();
    for (const c of mine) if (c.missedAt) missedBy.set(c.userId, (missedBy.get(c.userId) ?? 0) + 1);
    const defaulted = [...missedBy.values()].filter((n) => n >= 2).length;
    const open = mine.filter((c) => !c.repaidAt);
    const firstDue = open
      .map((c) => c.dueBy)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const pots = payouts.filter((p) => p.round.groupId === g.id);
    const failed = pots.filter((p) => p.status === "FAILED");
    const retrying = failed.filter((p) => nextRetryAt(p) !== null).length;
    const candidates: [GroupWatch["reason"], number, string | null][] = [
      ["DEFAULT", defaulted, null],
      ["TRANSFER_FAILED", failed.length - retrying, null],
      ["DISPUTED", pots.filter((p) => p.status === "PAID").length, null],
      ["REPORTED", reportedIn(g.id), null],
      ["HELD", pots.filter((p) => p.status === "HELD").length, null],
      ["RETRYING", retrying, null],
      ["COVERED", open.length, firstDue ? isoDay(firstDue) : null],
    ];
    const found = candidates.find(([, n]) => n > 0);
    const watch: GroupWatch | null = found ? { reason: found[0], count: found[1], date: found[2] } : null;
    const red: GroupWatch["reason"][] = ["DEFAULT", "TRANSFER_FAILED", "DISPUTED", "REPORTED"];
    return { ...g, watch, health: !watch ? "GREEN" : red.includes(watch.reason) ? "RED" : "AMBER" };
  });
}

export function myGroups(mfiId: string) {
  return prisma.group.findMany({
    where: { mfiId, state: { in: [...VISIBLE_STATES] } },
    include: withRounds,
    orderBy: { startedAt: "desc" },
  });
}

// D68: each group's solidarity reserve, read from the ledger.
export async function withReserve(group: ConsoleGroup): Promise<ConsoleGroup> {
  return { ...group, reserveFcfa: await reserveBalance(group.id) };
}
