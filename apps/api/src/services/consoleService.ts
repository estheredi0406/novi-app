import type { AttentionItem, ConsoleGroup, ConsoleGroupDetail, ConsoleOverview, ConsoleRound } from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { currentRoundNumber, isoDay } from "../lib/schedule.js";
import { releasePayout, runPayouts } from "./payoutService.js";

// What an MFI officer sees and does in the console (Sprint 5.2). Every query
// is limited to the officer's own MFI: another MFI's group is answered with
// 404, as if it did not exist. Only totals leave this file, never which
// member paid what, nor names (D33, D53).

// Groups appear once they have reached the MFI: from STARTING, when Novi
// asks it to open the account. Drafts and cancelled groups are not its business.
const VISIBLE_STATES = ["STARTING", "ACTIVE", "COMPLETED"] as const;

const withRounds = {
  rulesVersions: true,
  rounds: { orderBy: { number: "asc" }, include: { contributions: { where: { status: "PAID" } }, payout: true } },
} satisfies Prisma.GroupInclude;

type LoadedGroup = Prisma.GroupGetPayload<{ include: typeof withRounds }>;

function sumPaid(round: LoadedGroup["rounds"][number]) {
  return round.contributions.reduce((total, c) => total + c.amountFcfa, 0);
}

function rulesOf(group: LoadedGroup) {
  const rules = group.rulesVersions.find((r) => r.version === group.currentVersion);
  if (!rules) throw new Error(`group ${group.id} has no rules version ${group.currentVersion}`);
  return rules;
}

function toConsoleGroup(group: LoadedGroup): ConsoleGroup {
  const rules = rulesOf(group);
  // Money in and out comes from the rounds' own rows, which match the ledger
  // line for line (D45, D49): one PAID contribution, one CONTRIBUTION line.
  const collectedFcfa = group.rounds.reduce((total, r) => total + sumPaid(r), 0);
  const paidOutFcfa = group.rounds.reduce((total, r) => total + (r.payout?.status === "PAID" ? r.payout.amountFcfa : 0), 0);
  const needsAttention = group.rounds.filter((r) => r.payout?.status === "HELD" || r.payout?.status === "FAILED").length;
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
        ? currentRoundNumber(group.rounds.map((r) => r.dueDate), new Date())
        : null,
    rounds: group.rounds.length,
    collectedFcfa,
    paidOutFcfa,
    balanceFcfa: collectedFcfa - paidOutFcfa,
    needsAttention,
  };
}

function myGroups(mfiId: string) {
  return prisma.group.findMany({
    where: { mfiId, state: { in: [...VISIBLE_STATES] } },
    include: withRounds,
    orderBy: { startedAt: "desc" },
  });
}

export async function listConsoleGroups(mfiId: string): Promise<ConsoleGroup[]> {
  return (await myGroups(mfiId)).map(toConsoleGroup);
}

export async function getConsoleGroup(mfiId: string, groupId: string): Promise<ConsoleGroupDetail> {
  const group = await prisma.group.findFirst({
    where: { id: groupId, mfiId, state: { in: [...VISIBLE_STATES] } },
    include: withRounds,
  });
  if (!group) throw new AppError("NOT_FOUND", 404);

  const rules = rulesOf(group);
  const roundList: ConsoleRound[] = group.rounds.map((round) => ({
    number: round.number,
    dueDate: isoDay(round.dueDate),
    expectedFcfa: rules.amountFcfa * rules.size,
    collectedFcfa: sumPaid(round),
    paymentsReceived: round.contributions.length,
    paymentsExpected: rules.size,
    receiverTurn: round.number,
    payout: round.payout && {
      status: round.payout.status,
      amountFcfa: round.payout.amountFcfa,
      heldSince: round.payout.heldSince?.toISOString() ?? null,
      paidAt: round.payout.paidAt?.toISOString() ?? null,
      mfiRef: round.payout.mfiRef,
    },
  }));
  return { ...toConsoleGroup(group), roundList };
}

// Held and failed payouts at this MFI, oldest first: what needs a look.
export async function listAttention(mfiId: string): Promise<AttentionItem[]> {
  const payouts = await prisma.payout.findMany({
    where: {
      round: { group: { mfiId } },
      OR: [
        { status: { in: ["READY", "HELD", "FAILED"] } },
        { status: "PAID", receiptDisputedAt: { not: null } },
      ],
    },
    include: {
      round: {
        include: {
          contributions: { where: { status: "PAID" } },
          group: { include: { rulesVersions: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return payouts.map((payout) => {
    const { round } = payout;
    const rules = round.group.rulesVersions.find((r) => r.version === round.group.currentVersion);
    const expected = rules?.size ?? round.contributions.length;
    return {
      payoutId: payout.id,
      groupId: round.groupId,
      groupName: round.group.name,
      roundNumber: round.number,
      dueDate: isoDay(round.dueDate),
      status: (payout.status === "PAID" ? "DISPUTED" : payout.status) as AttentionItem["status"],
      amountFcfa: round.contributions.reduce((total, c) => total + c.amountFcfa, 0),
      paymentsMissing: Math.max(0, expected - round.contributions.length),
      since: (payout.heldSince ?? payout.requestedAt ?? payout.createdAt).toISOString(),
      canRetry: payout.status === "FAILED",
      canRelease: payout.status === "READY",
      receiverTurn: round.number,
    };
  });
}

export async function getOverview(mfiId: string): Promise<ConsoleOverview> {
  const [mfi, groups, attention] = await Promise.all([
    prisma.mfi.findUniqueOrThrow({ where: { id: mfiId } }),
    myGroups(mfiId),
    listAttention(mfiId),
  ]);
  const summaries = groups.map(toConsoleGroup);
  return {
    mfiName: mfi.name,
    activeGroups: summaries.filter((g) => g.state === "ACTIVE").length,
    completedGroups: summaries.filter((g) => g.state === "COMPLETED").length,
    balanceFcfa: summaries.reduce((total, g) => total + g.balanceFcfa, 0),
    held: attention.filter((a) => a.status === "HELD").length,
    failed: attention.filter((a) => a.status === "FAILED").length,
    ready: attention.filter((a) => a.status === "READY").length,
    disputed: attention.filter((a) => a.status === "DISPUTED").length,
  };
}

// The officer releases a full, due pot (D63): only then does Novi instruct
// the MFI to send it. Logged with her name, like every officer action.
export async function releaseRoundPayout(mfiId: string, staffId: string, payoutId: string): Promise<AttentionItem[]> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, round: { group: { mfiId } } },
    include: { round: { select: { number: true } } },
  });
  if (!payout) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "READY") throw new AppError("NOT_ALLOWED_NOW", 409);

  await prisma.auditEvent.create({
    data: { type: "STAFF_PAYOUT_RELEASED", details: { staffId, payoutId, round: payout.round.number } },
  });
  await releasePayout(payoutId, staffId);
  return listAttention(mfiId);
}

// The officer asks for a failed transfer to be tried again now, instead of
// waiting for the next run of the payout job (D53). Only a FAILED payout of
// this MFI; the job's own claim makes a double send impossible (D49).
export async function retryPayout(mfiId: string, staffId: string, payoutId: string): Promise<AttentionItem[]> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, round: { group: { mfiId } } },
    include: { round: { select: { groupId: true, number: true } } },
  });
  if (!payout) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "FAILED") throw new AppError("NOT_ALLOWED_NOW", 409);

  await prisma.auditEvent.create({
    data: { type: "STAFF_PAYOUT_RETRY", details: { staffId, payoutId, round: payout.round.number } },
  });
  await runPayouts(new Date(), payout.round.groupId);
  return listAttention(mfiId);
}
