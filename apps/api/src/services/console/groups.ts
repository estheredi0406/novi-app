// The MFI's groups: the list, one group with its members' records, and
// validating or refusing a group before its account opens (D66).

import type { ConsoleGroup, ConsoleGroupDetail, ConsoleMemberCard, ConsoleRound } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { potShare } from "../../lib/groupRules.js";
import { isoDay } from "../../lib/schedule.js";
import { openApprovedGroup } from "../group/index.js";
import { owedCovers } from "../memberService.js";
import { notifyGroupStatus } from "../notifyService.js";
import { groupPageExtras } from "../consoleGroupService.js";
import { savingsTerms } from "../savingsService.js";
import { VISIBLE_STATES, myGroups, onTimePct, rulesOf, toConsoleGroup, withHealth, withReserve, withRounds } from "./shared.js";

export async function listConsoleGroups(
  mfiId: string,
): Promise<ConsoleGroup[]> {
  return withHealth(mfiId, await Promise.all((await myGroups(mfiId)).map(toConsoleGroup).map(withReserve)));
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
      mfiRef: round.payout.mfiRef ? round.payout.mfiRef.replace(/^fedapay:/, "") : null,
      auto: round.payout.releasedAt !== null && round.payout.releasedById === null,
      via: round.payout.sentVia,
      receipt: round.payout.receiptDisputedAt ? "DISPUTED" : round.payout.receiptConfirmedAt ? "CONFIRMED" : null,
    },
  }));
  const [withState] = await withHealth(mfiId, [await withReserve(toConsoleGroup(group))]);
  const base = withState as ConsoleGroup;
  // D117: the MFI's average on-time rate, to read this group's against it.
  const rates = (await listConsoleGroups(mfiId)).map((g) => g.onTimePct).filter((n): n is number => n !== null);
  return {
    ...base,
    ...(await groupPageExtras(mfiId, groupId, base.currentRound)),
    mfiOnTimePct: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
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
          phone: true,
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
          phone: null,
          lastPaidAt: null,
          otherActiveGroups: 0,
          skipsUsed: 0,
          missedTurns: 0,
        };
      }
      const userId = seat.user.id;
      const [cyclesCompleted, payments, owes, otherActiveGroups, skipsUsed, missedTurns] = await Promise.all([
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
        prisma.membership.count({
          where: { userId, state: "ACCEPTED", exitReason: null, groupId: { not: groupId }, group: { state: "ACTIVE" } },
        }),
        prisma.reserveCover.count({ where: { userId } }),
        prisma.reserveCover.count({ where: { userId, missedAt: { not: null } } }),
      ]);
      const lastPaid = payments.reduce<Date | null>(
        (last, c) => (c.paidAt && (!last || c.paidAt > last) ? c.paidAt : last),
        null,
      );
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
        phone: seat.user.phone,
        lastPaidAt: lastPaid?.toISOString() ?? null,
        otherActiveGroups,
        skipsUsed,
        missedTurns,
      };
    }),
  );
}

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
  // D147: members must be able to read the caisse's savings conditions
  // before their tontine starts.
  if (!(await savingsTerms(mfiId))) throw new AppError("SAVINGS_TERMS_MISSING", 409);
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
  await notifyGroupStatus(groupId, "DECLINED", null, reason); // D152
  return listConsoleGroups(mfiId);
}
