import type {
  AttentionItem,
  ConsoleActivity,
  ConsoleAnalytics,
  ConsoleGroup,
  ConsoleGroupDetail,
  ConsoleOverview,
  ConsoleRound,
} from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { potShare } from "../lib/groupRules.js";
import { currentRoundNumber, isoDay } from "../lib/schedule.js";
import { openApprovedGroup } from "./groupService.js";
import { releasePayout, runPayouts } from "./payoutService.js";
import { fundBalance, reserveBalance } from "./reserveService.js";

// What an MFI officer sees and does in the console (Sprint 5.2). Every query
// is limited to the officer's own MFI: another MFI's group is answered with
// 404, as if it did not exist. Only totals leave this file, never which
// member paid what, nor names (D33, D53).

// Groups appear once they have reached the MFI: from STARTING, when Novi
// asks it to open the account. Drafts and cancelled groups are not its business.
const VISIBLE_STATES = ["STARTING", "ACTIVE", "COMPLETED"] as const;

const withRounds = {
  rulesVersions: true,
  reserveReturns: true,
  rounds: { orderBy: { number: "asc" }, include: { contributions: { where: { status: "PAID" } }, payout: true } },
} satisfies Prisma.GroupInclude;

type LoadedGroup = Prisma.GroupGetPayload<{ include: typeof withRounds }>;

function sumPaid(round: LoadedGroup["rounds"][number]) {
  return round.contributions.reduce((total, c) => total + c.amountFcfa, 0);
}

function rulesOf(group: Pick<LoadedGroup, "id" | "currentVersion" | "rulesVersions">) {
  const rules = group.rulesVersions.find((r) => r.version === group.currentVersion);
  if (!rules) throw new Error(`group ${group.id} has no rules version ${group.currentVersion}`);
  return rules;
}

function toConsoleGroup(group: LoadedGroup): ConsoleGroup {
  const rules = rulesOf(group);
  // Money in and out comes from the rounds' own rows, which match the ledger
  // line for line (D45, D49): one PAID contribution, one CONTRIBUTION line.
  const collectedFcfa = group.rounds.reduce((total, r) => total + sumPaid(r), 0);
  const paidOutFcfa = group.rounds.reduce(
    (total, r) => total + (r.payout?.status === "PAID" ? r.payout.amountFcfa : 0),
    0,
  );
  // D68: the reserve, and what it already gave back at the end of a cycle.
  const returnedFcfa = group.reserveReturns.reduce((total, r) => total + r.amountFcfa, 0);
  const needsAttention = group.rounds.filter(
    (r) => r.payout?.status === "HELD" || r.payout?.status === "FAILED",
  ).length;
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
    balanceFcfa: collectedFcfa - paidOutFcfa - returnedFcfa,
    reserveFcfa: 0, // filled in by withReserve (D68)
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

// D68: each group's solidarity reserve, read from the ledger.
async function withReserve(group: ConsoleGroup): Promise<ConsoleGroup> {
  return { ...group, reserveFcfa: await reserveBalance(group.id) };
}

export async function listConsoleGroups(mfiId: string): Promise<ConsoleGroup[]> {
  return Promise.all((await myGroups(mfiId)).map(toConsoleGroup).map(withReserve));
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
    expectedFcfa: potShare(rules.amountFcfa) * rules.size,
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
  return { ...(await withReserve(toConsoleGroup(group))), roundList };
}

// Held and failed payouts at this MFI, oldest first: what needs a look.
export async function listAttention(mfiId: string): Promise<AttentionItem[]> {
  const payouts = await prisma.payout.findMany({
    where: {
      round: { group: { mfiId } },
      OR: [{ status: { in: ["READY", "HELD", "FAILED"] } }, { status: "PAID", receiptDisputedAt: { not: null } }],
    },
    include: {
      round: {
        include: {
          contributions: { where: { status: "PAID" } },
          reserveCovers: true,
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
      // The pot as it will leave: each payment less the reserve's share, plus
      // what the reserve covered (D68).
      amountFcfa:
        round.contributions.reduce((total, c) => total + potShare(c.amountFcfa), 0) +
        round.reserveCovers.reduce((total, c) => total + c.amountFcfa, 0),
      paymentsMissing: Math.max(0, expected - round.contributions.length - round.reserveCovers.length),
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

// ---------- Validating a group before its account opens (D66) ----------

async function waitingGroup(mfiId: string, groupId: string) {
  const group = await prisma.group.findFirst({ where: { id: groupId, mfiId } });
  if (!group) throw new AppError("NOT_FOUND", 404);
  if (group.state !== "STARTING") throw new AppError("NOT_ALLOWED_NOW", 409);
  return group;
}

// The officer approves: the MFI opens the group's account and the first
// round is scheduled. Logged with her name.
export async function approveGroup(mfiId: string, staffId: string, groupId: string): Promise<ConsoleGroup[]> {
  await waitingGroup(mfiId, groupId);
  await prisma.auditEvent.create({ data: { type: "STAFF_GROUP_APPROVED", details: { staffId, groupId } } });
  await openApprovedGroup(groupId);
  return listConsoleGroups(mfiId);
}

// The officer declines, with a reason the organiser reads. No money has
// moved, so the group simply stops (CANCELLED).
export async function declineGroup(
  mfiId: string,
  staffId: string,
  groupId: string,
  reason: string,
): Promise<ConsoleGroup[]> {
  await waitingGroup(mfiId, groupId);
  await prisma.$transaction([
    prisma.group.updateMany({ where: { id: groupId, state: "STARTING" }, data: { state: "CANCELLED" } }),
    prisma.auditEvent.create({ data: { type: "STAFF_GROUP_DECLINED", details: { staffId, groupId, reason } } }),
  ]);
  return listConsoleGroups(mfiId);
}

// ---------- Analytics (D67): totals only, never a member's name (D33) ----------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Monday 00:00 UTC of the week holding this date (Lome is on GMT).
function weekStart(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
}

export async function getAnalytics(mfiId: string, now = new Date(), weeks = 8): Promise<ConsoleAnalytics> {
  const from = new Date(weekStart(now).getTime() - (weeks - 1) * WEEK_MS);
  const [ledger, contributions, payouts, groups, seats] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { group: { mfiId }, createdAt: { gte: from }, type: { in: ["CONTRIBUTION", "PAYOUT"] } },
      select: { type: true, amountFcfa: true, createdAt: true },
    }),
    prisma.contribution.findMany({
      where: { round: { group: { mfiId } }, status: "PAID", paidAt: { not: null } },
      select: { paidAt: true, round: { select: { dueDate: true } } },
    }),
    prisma.payout.findMany({
      where: { round: { group: { mfiId } } },
      select: {
        status: true,
        releasedAt: true,
        receiptConfirmedAt: true,
        receiptDisputedAt: true,
        round: { select: { dueDate: true } },
      },
    }),
    prisma.group.groupBy({ by: ["state"], where: { mfiId }, _count: true }),
    prisma.membership.findMany({
      where: { payoutPosition: { not: null }, group: { mfiId, state: { in: ["ACTIVE", "COMPLETED"] } } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const series = Array.from({ length: weeks }, (_, i) => ({
    weekOf: isoDay(new Date(from.getTime() + i * WEEK_MS)),
    collectedFcfa: 0,
    paidOutFcfa: 0,
    payments: 0,
    onTime: 0,
  }));
  const slot = (date: Date) => Math.floor((weekStart(date).getTime() - from.getTime()) / WEEK_MS);
  for (const line of ledger) {
    const week = series[slot(line.createdAt)];
    if (!week) continue;
    if (line.type === "CONTRIBUTION") week.collectedFcfa += line.amountFcfa;
    else week.paidOutFcfa += line.amountFcfa;
  }
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let onTimeAll = 0;
  for (const c of contributions) {
    const paidAt = c.paidAt as Date;
    const onTime = day(paidAt) <= day(c.round.dueDate);
    if (onTime) onTimeAll += 1;
    const week = series[slot(paidAt)];
    if (!week) continue;
    week.payments += 1;
    if (onTime) week.onTime += 1;
  }

  // How long a full pot waits for the officer after its due date (D63).
  const released = payouts.filter((p) => p.releasedAt);
  const waitHours = released.map((p) =>
    Math.max(0, ((p.releasedAt as Date).getTime() - p.round.dueDate.getTime()) / 3_600_000),
  );
  const answered = payouts.filter((p) => p.receiptConfirmedAt || p.receiptDisputedAt);

  // Per group: how regular its members are, and how far its cycle has gone.
  const started = await prisma.group.findMany({
    where: { mfiId, state: { in: [...VISIBLE_STATES] } },
    orderBy: { startedAt: "desc" },
    include: {
      rulesVersions: true,
      rounds: {
        include: {
          payout: true,
          contributions: { where: { status: "PAID" }, select: { paidAt: true, amountFcfa: true } },
        },
      },
    },
  });
  const byGroup = started.map((group) => {
    const paid = group.rounds.flatMap((r) => r.contributions.map((c) => ({ c, due: r.dueDate })));
    const onTime = paid.filter(({ c, due }) => c.paidAt && day(c.paidAt) <= day(due)).length;
    return {
      groupId: group.id,
      name: group.name,
      state: group.state as "STARTING" | "ACTIVE" | "COMPLETED",
      members: rulesOf(group).size,
      collectedFcfa: paid.reduce((sum, { c }) => sum + c.amountFcfa, 0),
      onTimeRate: paid.length ? Math.round((onTime / paid.length) * 100) : null,
      roundsPaidOut: group.rounds.filter((r) => r.payout?.status === "PAID").length,
      rounds: group.rounds.length || rulesOf(group).size,
      disputed: group.rounds.filter((r) => r.payout?.receiptDisputedAt).length,
    };
  });
  const count = (state: string) => groups.find((g) => g.state === state)?._count ?? 0;

  return {
    weeks: series,
    members: seats.length,
    groups: {
      starting: count("STARTING"),
      active: count("ACTIVE"),
      completed: count("COMPLETED"),
      cancelled: count("CANCELLED"),
    },
    onTimeRate: contributions.length ? Math.round((onTimeAll / contributions.length) * 100) : null,
    potsPaid: payouts.filter((p) => p.status === "PAID").length,
    potsDisputed: payouts.filter((p) => p.receiptDisputedAt).length,
    receiptConfirmedRate: answered.length
      ? Math.round((answered.filter((p) => p.receiptConfirmedAt).length / answered.length) * 100)
      : null,
    byGroup,
    solidarityFundFcfa: await fundBalance(mfiId),
    coversOpenFcfa:
      (
        await prisma.reserveCover.aggregate({
          where: { repaidAt: null, round: { group: { mfiId } } },
          _sum: { amountFcfa: true },
        })
      )._sum.amountFcfa ?? 0,
    medianReleaseHours: waitHours.length
      ? Math.round(waitHours.sort((a, b) => a - b)[Math.floor(waitHours.length / 2)] as number)
      : null,
  };
}

// ---------- What the officers did (D67) ----------

const ACTIVITY_LABELS = [
  "STAFF_GROUP_APPROVED",
  "STAFF_GROUP_DECLINED",
  "STAFF_PAYOUT_RELEASED",
  "STAFF_PAYOUT_RETRY",
  "STAFF_RECORD_OPENED",
  "STAFF_MEMBER_LOOKUP",
  "STAFF_MEMBER_EXIT",
  "STAFF_PHONE_CHANGED",
  "STAFF_ORGANISER_CHANGED",
] as const;

// Every action taken by this MFI's officers, newest first: who did what and
// when. Opening a shared record is included (each opening is logged, D54).
export async function listActivity(mfiId: string, limit = 100): Promise<ConsoleActivity[]> {
  const staff = await prisma.staffUser.findMany({ where: { mfiId }, select: { id: true, name: true } });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const [events, views] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { type: { in: [...ACTIVITY_LABELS] } },
      orderBy: { createdAt: "desc" },
      take: limit * 3,
    }),
    prisma.recordView.findMany({
      where: { staffId: { in: [...names.keys()] } },
      orderBy: { viewedAt: "desc" },
      take: limit,
      include: { share: { select: { payloadText: true } } },
    }),
  ]);

  const fromEvents = events.flatMap((event) => {
    const details = (event.details ?? {}) as { staffId?: string; round?: number; groupId?: string; reason?: string };
    const name = details.staffId ? names.get(details.staffId) : undefined;
    if (!name) return [];
    return [
      {
        at: event.createdAt.toISOString(),
        staffName: name,
        action: event.type as ConsoleActivity["action"],
        detail: details.reason ?? (details.round ? `round ${details.round}` : null),
      },
    ];
  });
  const fromViews = views.map((view) => ({
    at: view.viewedAt.toISOString(),
    staffName: names.get(view.staffId as string) ?? "",
    action: "STAFF_RECORD_OPENED" as const,
    detail: (JSON.parse(view.share.payloadText) as { legalName: string }).legalName,
  }));
  return [...fromEvents, ...fromViews].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
