// Analytics (D67): totals only, never a member's name (D33).

import type { ConsoleAnalytics } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { isoDay } from "../../lib/schedule.js";
import { fundBalance } from "../reserveService.js";
import { VISIBLE_STATES, rulesOf } from "./shared.js";

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
