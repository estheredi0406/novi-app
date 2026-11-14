// The "Aujourd'hui" page: today's figures and what waits for an officer.

import type { AttentionItem, ConsoleOverview, ConsoleToday } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { potShare } from "../../lib/groupRules.js";
import { isoDay } from "../../lib/schedule.js";
import { mfiBankTotal, syncCoreBanking } from "../coreBanking.js";
import { autoReleaseLimit, needsTwoOfficers, nextRetryAt } from "../payoutService.js";
import { savingsTerms, savingsToOpen } from "../savingsService.js";
import { mfi } from "../../providers/index.js";
import { listConsoleGroups } from "./groups.js";
import { myGroups, toConsoleGroup } from "./shared.js";
import { listReported } from "./payouts.js";

// D116: today's figures for "Aujourd'hui", and what Novi settled by itself.
export async function getToday(mfiId: string, now = new Date()): Promise<ConsoleToday> {
  const start = new Date(`${isoDay(now)}T00:00:00Z`);
  const inMfi = { round: { group: { mfiId } } };
  const end = new Date(start.getTime() + 24 * 3_600_000);
  // D150: the MFI's books follow the ledger, so the gap below is a real one.
  await syncCoreBanking(mfiId).catch(() => undefined);
  const [paid, sent, dueLeft, members, books, groups, late, alone, retried] = await Promise.all([
    prisma.contribution.aggregate({
      where: { ...inMfi, status: "PAID", paidAt: { gte: start } },
      _sum: { amountFcfa: true },
      _count: true,
    }),
    prisma.payout.aggregate({ where: { ...inMfi, status: "PAID", paidAt: { gte: start } }, _sum: { amountFcfa: true }, _count: true }),
    // D150: pots due today that have not reached their member yet.
    prisma.round.count({
      where: {
        group: { mfiId, state: "ACTIVE" },
        dueDate: { gte: start, lt: end },
        OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
      },
    }),
    prisma.membership.count({
      where: { group: { mfiId, state: "ACTIVE" }, payoutPosition: { not: null }, exitedAt: null },
    }),
    mfiBankTotal(mfiId),
    listConsoleGroups(mfiId),
    // Credited by an automatic check: paid after Novi asked again (D114).
    prisma.contribution.findMany({
      where: { ...inMfi, status: "PAID", paidAt: { gte: start }, lastCheckedAt: { not: null } },
      select: { paidAt: true, lastCheckedAt: true, reportedAt: true, reportCheckedById: true },
    }),
    // Released with no officer, and really arrived: a failed one is not "sent".
    prisma.payout.count({ where: { ...inMfi, status: "PAID", releasedAt: { gte: start }, releasedById: null } }),
    prisma.payout.count({ where: { ...inMfi, status: "PAID", paidAt: { gte: start }, attempts: { gt: 1 } } }),
  ]);
  const tontines = groups.reduce((n, g) => n + g.balanceFcfa, 0);
  const byCheck = late.filter((c) => c.paidAt && c.lastCheckedAt && c.paidAt >= c.lastCheckedAt && !c.reportCheckedById);
  return {
    receivedFcfa: paid._sum.amountFcfa ?? 0,
    payments: paid._count,
    potsSent: sent._count,
    potsSentFcfa: sent._sum.amountFcfa ?? 0,
    potsDueLeft: dueLeft,
    activeGroups: groups.filter((g) => g.state === "ACTIVE").length,
    activeMembers: members,
    toValidate: groups.filter((g) => g.state === "STARTING").length,
    tontinesFcfa: tontines,
    advancesFcfa: groups.reduce((n, g) => n + g.reserveFcfa, 0),
    booksGapFcfa: books.accounts === 0 ? 0 : tontines - books.totalFcfa,
    auto: {
      lateConfirmed: byCheck.length,
      reportsCleared: byCheck.filter((c) => c.reportedAt).length,
      potsAutoReleased: alone,
      transfersRetried: retried,
    },
  };
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

  // D141: pots that wait for the receiver's savings account to be opened.
  const toOpen = new Map(
    await Promise.all(
      payouts.map(async (p) => [p.id, ["READY", "FAILED"].includes(p.status) ? await savingsToOpen(p.id) : 0] as const),
    ),
  );

  // D144: what each receiver chose for her pot, so the officer sees the
  // split before releasing it (her choice is hers; the MFI only reads it).
  const wishes = await prisma.potChoice.findMany({ where: { roundId: { in: payouts.map((p) => p.roundId) } } });

  return payouts.map((payout) => {
    const { round } = payout;
    const wish = wishes.find((w) => w.roundId === payout.roundId && w.userId === payout.beneficiaryId);
    const waitsForSavings = toOpen.get(payout.id) ?? 0;
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
      // D114: tries so far, and when Novi tries again by itself (null: it
      // will not; the officer decides).
      attempts: payout.attempts,
      failReason: (payout.failReason ?? null) as AttentionItem["failReason"],
      nextRetryAt: nextRetryAt(payout)?.toISOString() ?? null,
      // D114: on a "not received", what the sender said when asked again.
      receiptCheck: (payout.receiptCheck as AttentionItem["receiptCheck"]) ?? null,
      sentTo: payout.status === "PAID" ? payout.phone : null,
      transferRef: payout.mfiRef ? payout.mfiRef.replace(/^fedapay:/, "") : null,
      // D105: a ready pot above the limit needs two different officers; the
      // one who gave the first approval cannot give the second.
      canRelease:
        payout.status === "READY" && waitsForSavings === 0 && !(staffId && payout.firstApprovedById === staffId),
      savingsToOpenFcfa: waitsForSavings,
      herKeepFcfa: payout.keptFcfa ?? wish?.keepFcfa ?? null,
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
    autoReleaseChosen: mfi.autoReleaseChosenAt !== null,
    savingsTermsComplete: (await savingsTerms(mfiId)) !== null,
  };
}
