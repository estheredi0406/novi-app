// Reading groups: one group as the app shows it, her groups, today's round.

import type { CurrentRound, GroupDetail, GroupSummary } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { countsTowardLimit, holdsSeat, potShare, advanceOf } from "../../lib/groupRules.js";
import { currentRoundNumber, isoDay } from "../../lib/schedule.js";
import { onTimeStreak } from "../../lib/streak.js";
import { mfi } from "../../providers/index.js";
import { unreadCount } from "../chatService.js";
import { reserveSummary } from "../reserveService.js";
import { currentRules, detailQuery, loadForMember, toRules } from "./shared.js";
import type { LoadedGroup } from "./shared.js";
import { mfiValidatesGroups } from "./start.js";

// "+22890123456" becomes "+228 90 •• •• 56": enough for the group to tell
// invitations apart, not enough to read the number.
function maskPhone(phone: string): string {
  const digits = phone.replace("+228", "");
  return `+228 ${digits.slice(0, 2)} •• •• ${digits.slice(6)}`;
}

function toDetail(group: LoadedGroup, userId: string): GroupDetail {
  const isOrganiser = group.organiserId === userId;
  return {
    id: group.id,
    name: group.name,
    state: group.state,
    mfiName: group.mfi.name,
    mfiReviews: mfiValidatesGroups(),
    rules: toRules(group),
    seats: group.memberships.filter(holdsSeat).map((seat) => ({
      memberId: seat.userId,
      displayName: seat.user.displayName,
      role: seat.role,
      state: seat.state,
      acceptedCurrentRules:
        seat.state === "ACCEPTED" &&
        seat.acceptedVersion === group.currentVersion,
      counterNote: seat.counterNote,
      payoutPosition: seat.payoutPosition,
      // The organiser typed each number herself, so part of it tells her
      // nothing new, and lets her check that the person who accepted is the
      // one she meant to invite (D43). Other members see names only (D15).
      maskedPhone: isOrganiser ? maskPhone(seat.user.phone) : null,
      exitReason: seat.exitReason,
    })),
    pendingInvites: group.invites.map((invite) => ({
      id: invite.id,
      maskedPhone: maskPhone(invite.phone),
    })),
    myRole: isOrganiser ? "ORGANISER" : "MEMBER",
    reserve: null, // filled in by getGroup once the group has started (D68)
    unreadMessages: 0, // filled in by getGroup (D70)
    cycleNumber: group.cycleNumber,
    previousCycleId: group.previousGroupId,
    nextCycleId: group.nextCycle?.id ?? null,
    ...continueOf(group, userId),
  };
}

// D80: once the cycle is complete, each member who finished it says whether
// she goes again; the whole group sees the answers, as they would at the
// market.
function continueOf(
  group: LoadedGroup,
  userId: string,
): Pick<GroupDetail, "continueAnswers" | "myContinue"> {
  if (group.state !== "COMPLETED")
    return { continueAnswers: null, myContinue: null };
  const finished = group.memberships.filter(
    (m) => m.payoutPosition !== null && m.exitReason === null,
  );
  const names = (answer: boolean | null) =>
    finished
      .filter((m) => m.continueAnswer === answer)
      .map((m) => m.user.displayName);
  return {
    continueAnswers: {
      yes: names(true),
      no: names(false),
      waiting: names(null),
    },
    myContinue:
      finished.find((m) => m.userId === userId)?.continueAnswer ?? null,
  };
}

// "Oui, je continue" or "Non, j'arrête", until the next cycle is started.
// She can change her mind until then.
export async function answerContinue(
  groupId: string,
  userId: string,
  continues: boolean,
): Promise<GroupDetail> {
  const { group, mySeat } = await loadForMember(groupId, userId);
  if (
    group.state !== "COMPLETED" ||
    group.nextCycle ||
    mySeat.payoutPosition === null ||
    mySeat.exitReason
  ) {
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  await prisma.membership.update({
    where: { id: mySeat.id },
    data: { continueAnswer: continues, continueAt: new Date() },
  });
  return getGroup(groupId, userId);
}

export async function getGroup(
  groupId: string,
  userId: string,
): Promise<GroupDetail> {
  const { group, mySeat } = await loadForMember(groupId, userId);
  const detail = {
    ...toDetail(group, userId),
    unreadMessages: await unreadCount(group.id, userId, mySeat.chatReadAt),
  };
  if (group.state !== "ACTIVE" && group.state !== "COMPLETED") return detail;
  return {
    ...detail,
    reserve: {
      ...(await reserveSummary(group.id, group.mfiId, userId, currentRules(group).amountFcfa)),
    },
  };
}

// Her groups, newest first: every group where she holds a seat.
export async function listMyGroups(userId: string): Promise<GroupSummary[]> {
  const seats = await prisma.membership.findMany({
    where: { userId, state: { notIn: ["DECLINED", "REMOVED"] } },
    orderBy: { createdAt: "desc" },
    include: { group: { include: detailQuery } },
  });
  return Promise.all(
    seats.map(async ({ group, state, chatReadAt }) => {
      const detail = toDetail(group, userId);
      // The round and the unread count are independent: asked together,
      // home waits for the slower of the two, not their sum.
      const [currentRound, unreadMessages] = await Promise.all([
        group.state === "ACTIVE"
          ? currentRoundFor(group.id, userId, detail.rules)
          : Promise.resolve(null),
        unreadCount(group.id, userId, chatReadAt),
      ]);
      return {
        id: detail.id,
        name: detail.name,
        cycleNumber: detail.cycleNumber,
        state: detail.state,
        mfiName: detail.mfiName,
        amountFcfa: detail.rules.amountFcfa,
        frequency: detail.rules.frequency,
        dueDay: detail.rules.dueDay,
        size: detail.rules.size,
        seatsHeld: detail.seats.length,
        myRole: detail.myRole,
        mySeatState: state,
        currentRound,
        unreadMessages,
      };
    }),
  );
}

// Today's round in a running group, from her side: has she paid, is the pot
// hers. D139: if her pot went to her phone, we ask her if it arrived.
function toConfirm(
  payout: {
    id: string;
    status: string;
    amountFcfa: number;
    keptFcfa: number | null;
    receiptConfirmedAt: Date | null;
    receiptDisputedAt: Date | null;
  } | null,
): { payoutId: string; amountFcfa: number } | null {
  if (!payout || payout.status !== "PAID" || payout.receiptConfirmedAt || payout.receiptDisputedAt) return null;
  const sent = payout.amountFcfa - (payout.keptFcfa ?? 0);
  return sent > 0 ? { payoutId: payout.id, amountFcfa: sent } : null;
}

async function currentRoundFor(
  groupId: string,
  userId: string,
  rules: { amountFcfa: number; size: number },
): Promise<CurrentRound | null> {
  const rounds = await prisma.round.findMany({
    where: { groupId },
    orderBy: { number: "asc" },
    include: {
      contributions: { where: { userId } },
      payout: {
        select: { id: true, status: true, amountFcfa: true, keptFcfa: true, receiptConfirmedAt: true, receiptDisputedAt: true },
      },
      beneficiary: { select: { displayName: true } },
    },
  });
  const now = new Date();
  const round = rounds.at(
    currentRoundNumber(
      rounds.map((r) => r.dueDate),
      now,
    ) - 1,
  );
  if (!round) return null;

  const mine = rounds.find((r) => r.beneficiaryId === userId);
  const next = rounds.find((r) => r.number === round.number + 1);
  // D144: what she chose to keep in savings from her pot, for home.
  const myChoice = mine ? await prisma.potChoice.findUnique({ where: { roundId: mine.id } }) : null;
  const paidBy = new Set(
    (
      await prisma.contribution.findMany({
        where: { roundId: round.id, status: "PAID" },
        select: { userId: true },
      })
    ).map((c) => c.userId),
  );
  const paidCount = paidBy.size;
  const day = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const upToNow = rounds.filter((r) => r.number <= round.number);
  const streak = onTimeStreak(
    upToNow.map((r) => {
      const paid = r.contributions.find((c) => c.status === "PAID");
      return {
        dueDay: day(r.dueDate),
        paidDay: paid?.paidAt ? day(paid.paidAt) : null,
      };
    }),
    day(now),
  );

  return {
    number: round.number,
    dueDate: isoDay(round.dueDate),
    myStatus: round.contributions.at(0)?.status ?? "UNPAID",
    isMyTurn: round.beneficiaryId === userId,
    potFcfa: potShare(rules.amountFcfa) * rules.size,
    paidCount,
    receiverName: round.beneficiary.displayName,
    advanceFcfa: round.number === 1 ? advanceOf(rules.amountFcfa) : 0,
    // D92: one seat per round, in turn order, for the ring on home.
    paidSeats: rounds.map((r) => paidBy.has(r.beneficiaryId)),
    // Where her own pot is comes from its payout, never from the date alone:
    // a round whose day has passed may still be held (D48).
    myTurn: mine
      ? {
          number: mine.number,
          dueDate: isoDay(mine.dueDate),
          payoutStatus: mine.payout?.status ?? "NOT_DUE",
          confirm: toConfirm(mine.payout),
          keepFcfa:
            mine.payout?.keptFcfa ?? (myChoice && myChoice.userId === userId ? myChoice.keepFcfa : 0),
        }
      : null,
    onTimeStreak: streak,
    nextDueDate: next ? isoDay(next.dueDate) : null,
  };
}

// How many of her seats count towards the 3-group limit (D26), not counting
// the group given, so the check can ask "and with this one?".
export async function countActiveGroups(
  userId: string,
  exceptGroupId?: string,
): Promise<number> {
  const seats = await prisma.membership.findMany({
    where: {
      userId,
      groupId: exceptGroupId ? { not: exceptGroupId } : undefined,
    },
    select: {
      state: true,
      acceptedVersion: true,
      group: { select: { state: true } },
    },
  });
  return seats.filter((seat) => countsTowardLimit(seat.group.state, seat))
    .length;
}
