import type {
  AttentionItem,
  ConsoleAdvance,
  ConsoleActivity,
  ConsoleAnalytics,
  ConsoleGroup,
  ConsoleGroupDetail,
  ConsoleMemberCard,
  ConsoleAccounts,
  ConsoleGroupAccount,
  ConsoleOverview,
  ConsoleReported,
  ConsoleRound,
} from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { potShare } from "../lib/groupRules.js";
import { currentRoundNumber, isoDay } from "../lib/schedule.js";
import { openApprovedGroup } from "./groupService.js";
import { pilotMode } from "../lib/pilot.js";
import { owedCovers } from "./memberService.js";
import { notifyMembers } from "./notifyService.js";
import { groupAccount, mfiBankTotal, syncCoreBanking } from "./coreBanking.js";
import { accountBalance } from "./paymentAccounts.js";
import { creditFoundPayment, rejectReport } from "./moneyService.js";
import { autoReleaseLimit, needsTwoOfficers, releasePayout, runPayouts } from "./payoutService.js";
import { fundBalance, reserveBalance } from "./reserveService.js";
import { mfi } from "../providers/index.js";

// What an MFI officer sees and does in the console (Sprint 5.2). Every query
// is limited to the officer's own MFI: another MFI's group is answered with
// 404, as if it did not exist. Only totals leave this file, never which
// member paid what (D33, D53). The one exception is D84: the name and the
// summary record of a member who agreed to share it when joining.

// Groups appear once they have reached the MFI: from STARTING, when Novi
// asks it to open the account. Drafts and cancelled groups are not its business.
const VISIBLE_STATES = ["STARTING", "ACTIVE", "COMPLETED"] as const;

const withRounds = {
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

function rulesOf(
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

function toConsoleGroup(group: LoadedGroup): ConsoleGroup {
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

export async function listConsoleGroups(
  mfiId: string,
): Promise<ConsoleGroup[]> {
  return Promise.all(
    (await myGroups(mfiId)).map(toConsoleGroup).map(withReserve),
  );
}

export async function getConsoleGroup(
  mfiId: string,
  groupId: string,
): Promise<ConsoleGroupDetail> {
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
    // Toward this pot only: round 1's advances stay in the group's advances (D103).
    collectedFcfa: round.contributions.reduce((total, c) => total + c.amountFcfa - c.advanceFcfa, 0),
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
  return {
    ...(await withReserve(toConsoleGroup(group))),
    roundList,
    // D98: members' records help the officer decide; once the group is
    // validated or declined, they are no longer shown.
    members: group.state === "STARTING" ? await memberCards(groupId) : [],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// D84: the record of each member who agreed to share it, so the officer
// validates people, not a number. A payment is on time when it was made by
// the end of its round's due day. Only totals: never which round she missed.
async function memberCards(groupId: string): Promise<ConsoleMemberCard[]> {
  const seats = await prisma.membership.findMany({
    where: { groupId, state: "ACCEPTED", exitReason: null },
    include: {
      user: {
        select: {
          id: true,
          legalName: true,
          idVerifiedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ payoutPosition: "asc" }, { createdAt: "asc" }],
  });
  return Promise.all(
    seats.map(async (seat): Promise<ConsoleMemberCard> => {
      const base = {
        turn: seat.payoutPosition,
        organiser: seat.role === "ORGANISER",
        consent: seat.shareConsentAt !== null,
      };
      if (!seat.shareConsentAt) {
        return {
          ...base,
          name: null,
          verifiedAt: null,
          memberSince: null,
          cyclesCompleted: 0,
          paymentsMade: 0,
          paymentsOnTime: 0,
          owesCaisseFcfa: 0,
        };
      }
      const userId = seat.user.id;
      const [cyclesCompleted, payments, owes] = await Promise.all([
        prisma.membership.count({
          where: {
            userId,
            state: "ACCEPTED",
            exitReason: null,
            group: { state: "COMPLETED" },
          },
        }),
        prisma.contribution.findMany({
          where: { userId, status: "PAID" },
          select: { paidAt: true, round: { select: { dueDate: true } } },
        }),
        owedCovers(userId),
      ]);
      const onTime = payments.filter(
        (c) =>
          c.paidAt !== null &&
          c.paidAt.getTime() < c.round.dueDate.getTime() + DAY_MS,
      ).length;
      return {
        ...base,
        name: seat.user.legalName,
        verifiedAt: seat.user.idVerifiedAt.toISOString(),
        memberSince: seat.user.createdAt.toISOString(),
        cyclesCompleted,
        paymentsMade: payments.length,
        paymentsOnTime: onTime,
        owesCaisseFcfa: owes,
      };
    }),
  );
}

// Held and failed payouts at this MFI, oldest first: what needs a look.
export async function listAttention(mfiId: string, staffId?: string): Promise<AttentionItem[]> {
  const limit = await autoReleaseLimit(mfiId);
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
          reserveCovers: true,
          group: { include: { rulesVersions: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  // D105: the officer who gave the first approval of a large pot, by name.
  const firstIds = [...new Set(payouts.map((p) => p.firstApprovedById).filter((x): x is string => Boolean(x)))];
  const firstNames = new Map(
    (await prisma.staffUser.findMany({ where: { id: { in: firstIds } }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name],
    ),
  );

  return payouts.map((payout) => {
    const { round } = payout;
    const rules = round.group.rulesVersions.find(
      (r) => r.version === round.group.currentVersion,
    );
    const expected = rules?.size ?? round.contributions.length;
    return {
      payoutId: payout.id,
      groupId: round.groupId,
      groupName: round.group.name,
      roundNumber: round.number,
      dueDate: isoDay(round.dueDate),
      status: (payout.status === "PAID"
        ? "DISPUTED"
        : payout.status) as AttentionItem["status"],
      // The pot as it will leave: each payment less her advance (round 1,
      // D103), plus what the advances covered for members who did not pay.
      amountFcfa:
        round.contributions.reduce(
          (total, c) => total + potShare(c.amountFcfa - c.advanceFcfa),
          0,
        ) +
        round.reserveCovers
          .filter((cover) => !round.contributions.some((c) => c.userId === cover.userId))
          .reduce((total, c) => total + c.amountFcfa, 0),
      paymentsMissing: Math.max(
        0,
        expected - round.contributions.length - round.reserveCovers.length,
      ),
      // A dispute dates from her "not received", not from when the pot left.
      since: (
        (payout.status === "PAID" ? payout.receiptDisputedAt : null) ??
        payout.heldSince ??
        payout.requestedAt ??
        payout.createdAt
      ).toISOString(),
      canRetry: payout.status === "FAILED",
      // D105: a ready pot above the limit needs two different officers; the
      // one who gave the first approval cannot give the second.
      canRelease: payout.status === "READY" && !(staffId && payout.firstApprovedById === staffId),
      needsTwo: payout.status === "READY" && needsTwoOfficers(payout.amountFcfa, limit),
      firstApprovedBy: payout.firstApprovedById ? (firstNames.get(payout.firstApprovedById) ?? null) : null,
      receiverTurn: round.number,
    };
  });
}

export async function getOverview(mfiId: string): Promise<ConsoleOverview> {
  const [mfi, groups, attention, reported] = await Promise.all([
    prisma.mfi.findUniqueOrThrow({ where: { id: mfiId } }),
    myGroups(mfiId),
    listAttention(mfiId),
    listReported(mfiId),
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
    reported: reported.length,
    autoReleaseFcfa: mfi.autoReleaseFcfa,
  };
}

// The officer releases a full, due pot (D63): only then does Novi instruct
// the MFI to send it. Logged with her name, like every officer action.
export async function releaseRoundPayout(
  mfiId: string,
  staffId: string,
  payoutId: string,
): Promise<AttentionItem[]> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, round: { group: { mfiId } } },
    include: { round: { select: { number: true } } },
  });
  if (!payout) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "READY") throw new AppError("NOT_ALLOWED_NOW", 409);

  // D105: above the MFI's limit, a first officer approves and a second,
  // different one releases. Each step is logged with the officer's name.
  if (needsTwoOfficers(payout.amountFcfa, await autoReleaseLimit(mfiId))) {
    if (payout.firstApprovedById === staffId) throw new AppError("SECOND_OFFICER_NEEDED", 409);
    if (!payout.firstApprovedById) {
      const first = await prisma.payout.updateMany({
        where: { id: payoutId, status: "READY", firstApprovedById: null },
        data: { firstApprovedById: staffId, firstApprovedAt: new Date() },
      });
      if (first.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
      await prisma.auditEvent.create({
        data: { type: "STAFF_PAYOUT_APPROVED", details: { staffId, payoutId, round: payout.round.number } },
      });
      return listAttention(mfiId, staffId);
    }
  }

  await prisma.auditEvent.create({
    data: {
      type: "STAFF_PAYOUT_RELEASED",
      details: { staffId, payoutId, round: payout.round.number },
    },
  });
  await releasePayout(payoutId, staffId);
  return listAttention(mfiId, staffId);
}

// ---------- Payments a member says left her account (D105, D110) ----------

// Payments the operator did not confirm, which the member says were debited:
// the officer checks them against the operator's statement. Oldest first.
// The member is named here: the officer must find her payment.
export async function listReported(mfiId: string): Promise<ConsoleReported[]> {
  const rows = await prisma.contribution.findMany({
    where: { reportedAt: { not: null }, status: { not: "PAID" }, round: { group: { mfiId } } },
    include: { round: { include: { group: true } }, user: { select: { displayName: true } } },
    orderBy: { reportedAt: "asc" },
  });
  return rows.map((c) => ({
    contributionId: c.id,
    groupId: c.round.groupId,
    groupName: c.round.group.name,
    roundNumber: c.round.number,
    memberName: c.user.displayName,
    phone: c.payerPhone,
    operator: c.operator,
    amountFcfa: c.amountFcfa,
    providerRef: c.providerRef,
    requestedAt: c.requestedAt?.toISOString() ?? null,
    reportedAt: (c.reportedAt as Date).toISOString(),
  }));
}

// The officer's answer. Found on the operator's statement: the payment is
// credited as if the operator had confirmed it. Not found: she is told to
// pay again, and her report is closed.
export async function resolveReported(
  mfiId: string,
  staffId: string,
  contributionId: string,
  arrived: boolean,
): Promise<ConsoleReported[]> {
  const row = await prisma.contribution.findFirst({
    where: { id: contributionId, round: { group: { mfiId } } },
  });
  if (!row) throw new AppError("NOT_FOUND", 404);
  if (!row.reportedAt || row.status === "PAID") throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.auditEvent.create({
    data: {
      type: arrived ? "STAFF_PAYMENT_FOUND" : "STAFF_PAYMENT_NOT_FOUND",
      details: { staffId, contributionId },
    },
  });
  if (arrived) await creditFoundPayment(contributionId, staffId);
  else await rejectReport(contributionId, staffId);
  return listReported(mfiId);
}

// D105: the admin sets the amount up to which pots leave without an officer.
export async function setAutoRelease(mfiId: string, staffId: string, amountFcfa: number | null): Promise<number | null> {
  await prisma.mfi.update({ where: { id: mfiId }, data: { autoReleaseFcfa: amountFcfa } });
  await prisma.auditEvent.create({ data: { type: "STAFF_AUTO_RELEASE_SET", details: { staffId, amountFcfa } } });
  // Pots already waiting under the new limit leave on the job's next run.
  return amountFcfa;
}

// The officer asks for a failed transfer to be tried again now, instead of
// waiting for the next run of the payout job (D53). Only a FAILED payout of
// this MFI; the job's own claim makes a double send impossible (D49).
export async function retryPayout(
  mfiId: string,
  staffId: string,
  payoutId: string,
): Promise<AttentionItem[]> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, round: { group: { mfiId } } },
    include: { round: { select: { groupId: true, number: true } } },
  });
  if (!payout) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "FAILED") throw new AppError("NOT_ALLOWED_NOW", 409);

  await prisma.auditEvent.create({
    data: {
      type: "STAFF_PAYOUT_RETRY",
      details: { staffId, payoutId, round: payout.round.number },
    },
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
export async function approveGroup(
  mfiId: string,
  staffId: string,
  groupId: string,
): Promise<ConsoleGroup[]> {
  await waitingGroup(mfiId, groupId);
  await prisma.auditEvent.create({
    data: { type: "STAFF_GROUP_APPROVED", details: { staffId, groupId } },
  });
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
    prisma.group.updateMany({
      where: { id: groupId, state: "STARTING" },
      data: { state: "CANCELLED" },
    }),
    prisma.auditEvent.create({
      data: {
        type: "STAFF_GROUP_DECLINED",
        details: { staffId, groupId, reason },
      },
    }),
  ]);
  return listConsoleGroups(mfiId);
}

// ---------- Analytics (D67): totals only, never a member's name (D33) ----------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Monday 00:00 UTC of the week holding this date (Lome is on GMT).
function weekStart(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - day,
    ),
  );
}

export async function getAnalytics(
  mfiId: string,
  now = new Date(),
  weeks = 8,
): Promise<ConsoleAnalytics> {
  const from = new Date(weekStart(now).getTime() - (weeks - 1) * WEEK_MS);
  const [ledger, contributions, payouts, groups, seats] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        group: { mfiId },
        createdAt: { gte: from },
        type: { in: ["CONTRIBUTION", "PAYOUT"] },
      },
      select: { type: true, amountFcfa: true, createdAt: true },
    }),
    prisma.contribution.findMany({
      where: {
        round: { group: { mfiId } },
        status: "PAID",
        paidAt: { not: null },
      },
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
      where: {
        payoutPosition: { not: null },
        group: { mfiId, state: { in: ["ACTIVE", "COMPLETED"] } },
      },
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
  const slot = (date: Date) =>
    Math.floor((weekStart(date).getTime() - from.getTime()) / WEEK_MS);
  for (const line of ledger) {
    const week = series[slot(line.createdAt)];
    if (!week) continue;
    if (line.type === "CONTRIBUTION") week.collectedFcfa += line.amountFcfa;
    else week.paidOutFcfa += line.amountFcfa;
  }
  const day = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
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
    Math.max(
      0,
      ((p.releasedAt as Date).getTime() - p.round.dueDate.getTime()) /
        3_600_000,
    ),
  );
  const answered = payouts.filter(
    (p) => p.receiptConfirmedAt || p.receiptDisputedAt,
  );

  // Per group: how regular its members are, and how far its cycle has gone.
  const started = await prisma.group.findMany({
    where: { mfiId, state: { in: [...VISIBLE_STATES] } },
    orderBy: { startedAt: "desc" },
    include: {
      rulesVersions: true,
      rounds: {
        include: {
          payout: true,
          contributions: {
            where: { status: "PAID" },
            select: { paidAt: true, amountFcfa: true },
          },
        },
      },
    },
  });
  const byGroup = started.map((group) => {
    const paid = group.rounds.flatMap((r) =>
      r.contributions.map((c) => ({ c, due: r.dueDate })),
    );
    const onTime = paid.filter(
      ({ c, due }) => c.paidAt && day(c.paidAt) <= day(due),
    ).length;
    return {
      groupId: group.id,
      name: group.name,
      state: group.state as "STARTING" | "ACTIVE" | "COMPLETED",
      members: rulesOf(group).size,
      collectedFcfa: paid.reduce((sum, { c }) => sum + c.amountFcfa, 0),
      onTimeRate: paid.length ? Math.round((onTime / paid.length) * 100) : null,
      roundsPaidOut: group.rounds.filter((r) => r.payout?.status === "PAID")
        .length,
      rounds: group.rounds.length || rulesOf(group).size,
      disputed: group.rounds.filter((r) => r.payout?.receiptDisputedAt).length,
    };
  });
  const count = (state: string) =>
    groups.find((g) => g.state === state)?._count ?? 0;

  return {
    weeks: series,
    members: seats.length,
    groups: {
      starting: count("STARTING"),
      active: count("ACTIVE"),
      completed: count("COMPLETED"),
      cancelled: count("CANCELLED"),
    },
    onTimeRate: contributions.length
      ? Math.round((onTimeAll / contributions.length) * 100)
      : null,
    potsPaid: payouts.filter((p) => p.status === "PAID").length,
    potsDisputed: payouts.filter((p) => p.receiptDisputedAt).length,
    receiptConfirmedRate: answered.length
      ? Math.round(
          (answered.filter((p) => p.receiptConfirmedAt).length /
            answered.length) *
            100,
        )
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
      ? Math.round(
          waitHours.sort((a, b) => a - b)[
            Math.floor(waitHours.length / 2)
          ] as number,
        )
      : null,
  };
}

// ---------- What the officers did (D67) ----------

const ACTIVITY: Record<ConsoleActivity["action"], ConsoleActivity["category"]> = {
  STAFF_GROUP_APPROVED: "GROUPS",
  STAFF_GROUP_DECLINED: "GROUPS",
  STAFF_DEMO_DUE: "GROUPS",
  STAFF_PAYOUT_RELEASED: "MONEY",
  STAFF_PAYOUT_RETRY: "MONEY",
  STAFF_ADVANCE_SENT: "MONEY",
  STAFF_PAYOUT_APPROVED: "MONEY",
  STAFF_PAYMENT_FOUND: "MONEY",
  STAFF_PAYMENT_NOT_FOUND: "MONEY",
  STAFF_AUTO_RELEASE_SET: "MONEY",
  STAFF_PAYMENT_ACCOUNT_CONNECTED: "MONEY",
  STAFF_PAYMENT_ACCOUNT_DISCONNECTED: "MONEY",
  STAFF_PAYOUTS_ROUTE_SET: "MONEY",
  STAFF_RECORD_OPENED: "CREDIT",
  STAFF_CREDIT_POLICY_CHANGED: "CREDIT",
  STAFF_LOAN_PRESELECT: "CREDIT",
  STAFF_LOAN_DECLINE: "CREDIT",
  STAFF_LOAN_GRANT: "CREDIT",
  STAFF_LOAN_NOTGRANTED: "CREDIT",
  STAFF_LOAN_DOCUMENT_VIEWED: "CREDIT",
  STAFF_LOAN_DOCUMENT_REVIEWED: "CREDIT",
  STAFF_MEMBER_LOOKUP: "MEMBERS",
  STAFF_MEMBER_EXIT: "MEMBERS",
  STAFF_PHONE_CHANGED: "MEMBERS",
  STAFF_ORGANISER_CHANGED: "MEMBERS",
  STAFF_ADDED: "TEAM",
  STAFF_DEACTIVATED: "TEAM",
  STAFF_REACTIVATED: "TEAM",
  STAFF_ACCESS_RESET: "TEAM",
};
const ACTIVITY_LABELS = Object.keys(ACTIVITY) as ConsoleActivity["action"][];

type AuditDetails = {
  staffId?: string;
  round?: number;
  groupId?: string;
  payoutId?: string;
  advanceId?: string;
  loanId?: string;
  userId?: string;
  key?: string;
  accepted?: boolean;
  reason?: string;
};

// Every action taken by this MFI's officers, newest first: who did what, to
// which group or member, and when (D67). Opening a shared record is included
// (each opening is logged, D54), and so is every credit step (D91, D92).
export async function listActivity(
  mfiId: string,
  limit = 100,
): Promise<ConsoleActivity[]> {
  const staff = await prisma.staffUser.findMany({
    where: { mfiId },
    select: { id: true, name: true },
  });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const [events, views] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { type: { in: ACTIVITY_LABELS } },
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
  const mine = events
    .map((e) => ({ e, d: (e.details ?? {}) as AuditDetails }))
    .filter(({ d }) => d.staffId && names.has(d.staffId));

  // What each line is about, fetched once for all lines.
  const ids = (k: keyof AuditDetails) => [
    ...new Set(mine.map(({ d }) => d[k]).filter((v): v is string => typeof v === "string")),
  ];
  const [groups, payouts, advances, loans, users] = await Promise.all([
    prisma.group.findMany({ where: { id: { in: ids("groupId") } }, select: { id: true, name: true } }),
    prisma.payout.findMany({
      where: { id: { in: ids("payoutId") } },
      select: { id: true, amountFcfa: true, round: { select: { group: { select: { name: true } } } } },
    }),
    prisma.advance.findMany({
      where: { id: { in: ids("advanceId") } },
      select: { id: true, amountFcfa: true, group: { select: { name: true } } },
    }),
    prisma.loanRequest.findMany({
      where: { id: { in: ids("loanId") } },
      select: { id: true, amountFcfa: true, grantedFcfa: true, user: { select: { legalName: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: ids("userId") } }, select: { id: true, legalName: true } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const payout = new Map(payouts.map((p) => [p.id, p]));
  const advance = new Map(advances.map((a) => [a.id, a]));
  const loan = new Map(loans.map((l) => [l.id, l]));
  const userName = new Map(users.map((u) => [u.id, u.legalName]));

  const fromEvents: ConsoleActivity[] = mine.map(({ e, d }) => {
    const action = e.type as ConsoleActivity["action"];
    const p = d.payoutId ? payout.get(d.payoutId) : undefined;
    const a = d.advanceId ? advance.get(d.advanceId) : undefined;
    const l = d.loanId ? loan.get(d.loanId) : undefined;
    const subject =
      p?.round.group.name ??
      a?.group.name ??
      l?.user.legalName ??
      (d.userId ? userName.get(d.userId) : undefined) ??
      (d.groupId ? groupName.get(d.groupId) : undefined) ??
      // Team events keep the officer's name in "reason".
      (ACTIVITY[action] === "TEAM" ? d.reason : undefined) ??
      null;
    const detail =
      action === "STAFF_LOAN_DOCUMENT_REVIEWED"
        ? d.accepted
          ? "ACCEPTED"
          : "REDO"
        : action === "STAFF_LOAN_DOCUMENT_VIEWED"
          ? (d.key ?? null)
          : ACTIVITY[action] === "TEAM"
            ? null
            : (d.reason ?? null);
    return {
      at: e.createdAt.toISOString(),
      staffName: names.get(d.staffId as string) ?? "",
      action,
      category: ACTIVITY[action],
      subject,
      round: typeof d.round === "number" ? d.round : null,
      amountFcfa: p?.amountFcfa ?? a?.amountFcfa ?? l?.grantedFcfa ?? l?.amountFcfa ?? null,
      detail,
    };
  });
  const fromViews: ConsoleActivity[] = views.map((view) => ({
    at: view.viewedAt.toISOString(),
    staffName: names.get(view.staffId as string) ?? "",
    action: "STAFF_RECORD_OPENED",
    category: "CREDIT",
    subject: (JSON.parse(view.share.payloadText) as { legalName: string }).legalName,
    round: null,
    amountFcfa: null,
    detail: null,
  }));
  return [...fromEvents, ...fromViews]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

// ---------- Demo only (D82) ----------

// In the pilot, a round falls due a week or a month after the start (D44), so
// a test or a demonstration could not show a release on the day. This brings
// the next unpaid round's due date forward to today, then runs the payout job
// for the group at once: a full pot becomes "À libérer". Rounds before it
// that were also due today move to yesterday, so the brought-forward round is
// the one open for payment, and a whole cycle can be shown in one session.
// Only in pilot mode, only for this MFI's running groups, and written to the
// Journal.
export async function advanceDueDateForDemo(
  mfiId: string,
  staffId: string,
  groupId: string,
  now = new Date(),
) {
  if (!pilotMode()) throw new AppError("NOT_FOUND", 404);
  const group = await prisma.group.findFirst({
    where: { id: groupId, mfiId, state: "ACTIVE" },
  });
  if (!group) throw new AppError("NOT_FOUND", 404);
  const next = await prisma.round.findFirst({
    where: {
      groupId,
      dueDate: { gt: now },
      OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
    },
    orderBy: { number: "asc" },
  });
  if (!next) throw new AppError("NOT_ALLOWED_NOW", 409);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  await prisma.round.updateMany({
    where: { groupId, number: { lt: next.number }, dueDate: { gte: today } },
    data: { dueDate: yesterday },
  });
  await prisma.round.update({
    where: { id: next.id },
    data: { dueDate: today },
  });
  await prisma.auditEvent.create({
    data: {
      type: "STAFF_DEMO_DUE",
      details: { staffId, groupId, round: next.number },
    },
  });
  await runPayouts(now, groupId);
  return { round: next.number };
}

// ---------- D88: advances from the fund, sent by the officer ----------

// Approved by the group and waiting to be sent, or sent in the last 30 days.
// Like the pots, the member appears by her turn, never her name (D33).
export async function listAdvances(
  mfiId: string,
  now = new Date(),
): Promise<ConsoleAdvance[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const advances = await prisma.advance.findMany({
    where: {
      group: { mfiId },
      OR: [
        { status: "APPROVED" },
        {
          status: { in: ["SENT", "PAID", "REPAID"] },
          updatedAt: { gte: since },
        },
      ],
    },
    include: {
      group: {
        select: {
          name: true,
          memberships: { select: { userId: true, payoutPosition: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return advances.map((a) => ({
    id: a.id,
    groupId: a.groupId,
    groupName: a.group.name,
    amountFcfa: a.amountFcfa,
    status: a.status as ConsoleAdvance["status"],
    approvedAt: a.updatedAt.toISOString(),
    receiverTurn:
      a.group.memberships.find((m) => m.userId === a.userId)?.payoutPosition ??
      null,
  }));
}

// The officer sends an approved advance from the solidarity fund to her
// wallet, through the MFI, like a pot (D63). Claimed first, so it is never
// sent twice.
export async function sendAdvance(
  mfiId: string,
  staffId: string,
  advanceId: string,
): Promise<ConsoleAdvance[]> {
  const advance = await prisma.advance.findFirst({
    where: { id: advanceId, group: { mfiId } },
    include: { group: true, user: { select: { phone: true } } },
  });
  if (!advance) throw new AppError("NOT_FOUND", 404);
  if (advance.status !== "APPROVED") throw new AppError("NOT_ALLOWED_NOW", 409);
  if ((await reserveBalance(advance.groupId)) < advance.amountFcfa)
    throw new AppError("FUND_TOO_LOW", 409);
  if (!advance.group.mfiAccountRef) throw new AppError("NOT_ALLOWED_NOW", 409);

  const claimed = await prisma.advance.updateMany({
    where: { id: advance.id, status: "APPROVED" },
    data: { status: "SENT", releasedById: staffId },
  });
  if (claimed.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);

  const lastPayment = await prisma.contribution.findFirst({
    where: {
      userId: advance.userId,
      status: "PAID",
      round: { groupId: advance.groupId },
    },
    orderBy: { paidAt: "desc" },
  });
  let answer: Awaited<ReturnType<typeof mfi.sendPayout>>;
  try {
    answer = await mfi.sendPayout({
      payoutId: `advance-${advance.id}`,
      accountRef: advance.group.mfiAccountRef,
      amountFcfa: advance.amountFcfa,
      phone: advance.user.phone,
      operator: lastPayment?.operator ?? "MOOV_TG",
    });
  } catch {
    answer = { mfiRef: "", status: "FAILED" };
  }
  if (answer.status === "FAILED") {
    await prisma.advance.update({
      where: { id: advance.id },
      data: { status: "APPROVED", releasedById: null },
    });
    throw new AppError("MFI_UNAVAILABLE", 503);
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.advance.update({
      where: { id: advance.id },
      data: { status: "PAID", mfiRef: answer.mfiRef, paidAt: now },
    }),
    prisma.ledgerEntry.create({
      data: {
        groupId: advance.groupId,
        userId: advance.userId,
        type: "RESERVE_ADVANCE",
        amountFcfa: advance.amountFcfa,
        note: `advance ${advance.id}`,
      },
    }),
    prisma.auditEvent.create({
      data: { type: "STAFF_ADVANCE_SENT", details: { staffId, advanceId } },
    }),
  ]);
  await notifyMembers(
    [advance.userId],
    "money",
    `/groups/${advance.groupId}?tab=groupe`,
    {
      title: "Votre avance est envoyée",
      body: "Elle arrive sur votre Mobile Money. Elle sera reprise sur votre cagnotte.",
    },
    {
      title: "Your advance was sent",
      body: "It is on its way to your mobile money. It comes back out of your pot.",
    },
  );
  return listAdvances(mfiId);
}

// ---------- D113: the three views of the money, side by side ----------

// Novi's ledger (what each group should hold), the MFI's books (simulated
// core banking) and the real FedaPay balance. They differ only for a reason:
// a pot sent but not yet confirmed, FedaPay's fees, or money that is not
// Novi's in the same FedaPay account.
export async function getAccounts(mfiId: string): Promise<ConsoleAccounts> {
  await syncCoreBanking(mfiId);
  const [overview, bank, fedapay, inTransit] = await Promise.all([
    getOverview(mfiId),
    mfiBankTotal(mfiId),
    accountBalance(mfiId),
    prisma.payout.aggregate({
      where: { status: { in: ["SENDING", "SENT"] }, round: { group: { mfiId } } },
      _sum: { amountFcfa: true },
    }),
  ]);
  return {
    noviFcfa: overview.balanceFcfa,
    bankFcfa: bank.totalFcfa,
    bankAccounts: bank.accounts,
    fedapay,
    inTransitFcfa: inTransit._sum.amountFcfa ?? 0,
  };
}

export async function getGroupAccount(mfiId: string, groupId: string): Promise<ConsoleGroupAccount | null> {
  const group = await prisma.group.findFirst({ where: { id: groupId, mfiId }, select: { id: true } });
  if (!group) throw new AppError("NOT_FOUND", 404);
  await syncCoreBanking(mfiId);
  return groupAccount(groupId);
}
