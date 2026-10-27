import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { reserveShare } from "../lib/groupRules.js";
import { mfi } from "../providers/index.js";

// The solidarity reserve (D68). A small share of every contribution
// (RESERVE_PERCENT, groupRules.ts) is set aside. The shares of all the groups
// at one MFI form one solidarity fund, as the risk is pooled across many
// groups: a group's own few hundred francs could never cover a missing share,
// the fund can, from the first round. On a due date, if a member has not
// paid, the fund pays her share so the pot leaves full and the member whose
// turn it is is not penalised. Her late payment refills it. At the end of
// the cycle, what the group put in, less what its own members still owe,
// goes back to the members who owe nothing. Every movement is a ledger line.

type Tx = Prisma.TransactionClient;

// Called in the same transaction that credits a contribution, so the
// reserve's share is written exactly once (D45). If the reserve had covered
// her for this round, her payment repays it.
export async function creditReserve(
  tx: Tx,
  contribution: { id: string; roundId: string; userId: string; amountFcfa: number },
  groupId: string,
): Promise<void> {
  const share = reserveShare(contribution.amountFcfa);
  if (share > 0) {
    await tx.ledgerEntry.create({
      data: {
        groupId,
        roundId: contribution.roundId,
        userId: contribution.userId,
        type: "RESERVE_IN",
        amountFcfa: share,
        note: `contribution ${contribution.id}`,
      },
    });
  }
  const cover = await tx.reserveCover.findUnique({
    where: { roundId_userId: { roundId: contribution.roundId, userId: contribution.userId } },
  });
  if (cover && !cover.repaidAt) {
    const repaid = await tx.reserveCover.updateMany({
      where: { id: cover.id, repaidAt: null },
      data: { repaidAt: new Date() },
    });
    if (repaid.count === 1) {
      await tx.ledgerEntry.create({
        data: {
          groupId,
          roundId: contribution.roundId,
          userId: contribution.userId,
          type: "RESERVE_REPAY",
          amountFcfa: cover.amountFcfa,
          note: `cover ${cover.id}`,
        },
      });
    }
  }
}

const RESERVE_TYPES = ["RESERVE_IN", "RESERVE_COVER", "RESERVE_REPAY", "RESERVE_RETURN"] as const;
type Db = Tx | typeof prisma;

async function sumReserve(where: Prisma.LedgerEntryWhereInput, db: Db): Promise<number> {
  const sums = await db.ledgerEntry.groupBy({
    by: ["type"],
    where: { ...where, type: { in: [...RESERVE_TYPES] } },
    _sum: { amountFcfa: true },
  });
  const of = (type: string) => sums.find((s) => s.type === type)?._sum.amountFcfa ?? 0;
  return of("RESERVE_IN") + of("RESERVE_REPAY") - of("RESERVE_COVER") - of("RESERVE_RETURN");
}

// One group's place in the fund: what it put in and got back, less what the
// fund paid for its members and they have not repaid. Can be negative while
// one of its members owes a cover.
export function reserveBalance(groupId: string, db: Db = prisma): Promise<number> {
  return sumReserve({ groupId }, db);
}

// The MFI's whole solidarity fund: every group's reserve together.
export function fundBalance(mfiId: string, db: Db = prisma): Promise<number> {
  return sumReserve({ group: { mfiId } }, db);
}

// On or after a round's due date, with payments missing: if the reserve can
// pay every missing share, it does, in one transaction, and the round is
// treated as full. Returns false (nothing written) when it cannot.
export async function coverMissing(
  round: { id: string; groupId: string },
  amountFcfa: number,
  now: Date,
): Promise<boolean> {
  const net = amountFcfa - reserveShare(amountFcfa);
  return prisma.$transaction(async (tx) => {
    const seats = await tx.membership.findMany({
      where: { groupId: round.groupId, payoutPosition: { not: null } },
      select: { userId: true },
    });
    const paid = await tx.contribution.findMany({
      where: { roundId: round.id, status: "PAID" },
      select: { userId: true },
    });
    const covered = await tx.reserveCover.findMany({ where: { roundId: round.id }, select: { userId: true } });
    const settled = new Set([...paid, ...covered].map((x) => x.userId));
    const missing = seats.filter((s) => !settled.has(s.userId));
    if (missing.length === 0) return true;
    const group = await tx.group.findUniqueOrThrow({ where: { id: round.groupId }, select: { mfiId: true } });
    if ((await fundBalance(group.mfiId, tx)) < missing.length * net) return false;

    // D69: after a death, nobody owes her shares: the fund carries them.
    const deceased = new Set(
      (
        await tx.membership.findMany({
          where: { groupId: round.groupId, exitReason: "DEATH" },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    for (const { userId } of missing) {
      const cover = await tx.reserveCover.create({
        data: {
          roundId: round.id,
          userId,
          amountFcfa: net,
          coveredAt: now,
          writtenOffAt: deceased.has(userId) ? now : null,
        },
      });
      await tx.ledgerEntry.create({
        data: {
          groupId: round.groupId,
          roundId: round.id,
          userId,
          type: "RESERVE_COVER",
          amountFcfa: net,
          note: `cover ${cover.id}`,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        type: "RESERVE_COVERED",
        details: { roundId: round.id, members: missing.length, amountFcfa: missing.length * net },
      },
    });
    return true;
  });
}

// At the end of the cycle (D68): the group's place in the fund goes back,
// through the MFI, to the members who owe it nothing, in proportion to what
// each put in. A member who still owes a covered round gets nothing back.
// Run once: a second run finds the returns already written.
export async function returnReserve(groupId: string): Promise<void> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  if (group.state !== "COMPLETED" || !group.mfiAccountRef) return;
  if ((await prisma.reserveReturn.count({ where: { groupId } })) > 0) return;

  // Shares written off after a death are the whole fund's loss, not this
  // group's (D69): the members who paid are not made to carry them.
  const writtenOff = await prisma.reserveCover.aggregate({
    where: { round: { groupId }, writtenOffAt: { not: null }, repaidAt: null },
    _sum: { amountFcfa: true },
  });
  // Never more than the fund holds, if other groups' losses emptied it.
  const balance = Math.min(
    (await reserveBalance(groupId)) + (writtenOff._sum.amountFcfa ?? 0),
    await fundBalance(group.mfiId),
  );
  if (balance <= 0) return;
  const putIn = await prisma.ledgerEntry.groupBy({
    by: ["userId"],
    where: { groupId, type: "RESERVE_IN" },
    _sum: { amountFcfa: true },
  });
  const owing = new Set(
    (
      await prisma.reserveCover.findMany({
        where: { round: { groupId }, repaidAt: null, writtenOffAt: null },
        select: { userId: true },
      })
    ).map((c) => c.userId),
  );
  const eligible = putIn.filter((p) => p.userId && !owing.has(p.userId));
  const total = eligible.reduce((sum, p) => sum + (p._sum.amountFcfa ?? 0), 0);
  if (total === 0) return;

  // Whole FCFA: each gets her proportional part rounded down; the few francs
  // left by rounding go to the first, so the reserve ends at exactly zero.
  const parts = eligible.map((p) => ({
    userId: p.userId as string,
    amount: Math.floor((balance * (p._sum.amountFcfa ?? 0)) / total),
  }));
  const rest = balance - parts.reduce((sum, p) => sum + p.amount, 0);
  if (parts[0]) parts[0].amount += rest;

  for (const part of parts.filter((p) => p.amount > 0)) {
    // After she left or died, her part goes where the officer recorded (D69).
    const seat = await prisma.membership.findFirst({
      where: { groupId, userId: part.userId },
      select: { exitPayoutPhone: true, user: { select: { phone: true } } },
    });
    const user = { phone: seat?.exitPayoutPhone ?? seat?.user.phone ?? "" };
    if (!user.phone) continue;
    const last = await prisma.contribution.findFirst({
      where: { userId: part.userId, status: "PAID", round: { groupId } },
      orderBy: { paidAt: "desc" },
    });
    const operator = last?.operator ?? "MOOV_TG";
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.reserveReturn.create({
        data: { groupId, userId: part.userId, amountFcfa: part.amount, phone: user.phone, operator, status: "SENDING" },
      });
      await tx.ledgerEntry.create({
        data: {
          groupId,
          userId: part.userId,
          type: "RESERVE_RETURN",
          amountFcfa: part.amount,
          note: `return ${row.id}`,
        },
      });
      return row;
    });
    try {
      const answer = await mfi.sendPayout({
        payoutId: created.id,
        accountRef: group.mfiAccountRef,
        amountFcfa: part.amount,
        phone: user.phone,
        operator,
      });
      await prisma.reserveReturn.update({
        where: { id: created.id },
        data: { status: answer.status, mfiRef: answer.mfiRef, paidAt: answer.status === "PAID" ? new Date() : null },
      });
    } catch (err) {
      console.error(`MFI did not accept reserve return ${created.id}:`, err);
      await prisma.reserveReturn.update({ where: { id: created.id }, data: { status: "FAILED" } });
    }
  }
  await prisma.auditEvent.create({ data: { type: "RESERVE_RETURNED", details: { groupId, amountFcfa: balance } } });
}

// What a member or an officer sees of the reserve.
export async function reserveSummary(groupId: string, mfiId: string) {
  const [balance, fund, open] = await Promise.all([
    reserveBalance(groupId),
    fundBalance(mfiId),
    prisma.reserveCover.aggregate({
      where: { round: { groupId }, repaidAt: null, writtenOffAt: null },
      _sum: { amountFcfa: true },
      _count: true,
    }),
  ]);
  return { balanceFcfa: balance, fundFcfa: fund, owedFcfa: open._sum.amountFcfa ?? 0, coversOpen: open._count };
}

// D69: before her pot leaves, what the fund paid for her in this group and
// she has not paid back is taken from it first, so a member cannot collect
// the pot and leave her debt behind. Runs inside the release transaction;
// returns what was repaid.
export async function repayFromPot(tx: Tx, groupId: string, userId: string, potFcfa: number): Promise<number> {
  const open = await tx.reserveCover.findMany({
    where: { userId, round: { groupId }, repaidAt: null, writtenOffAt: null },
    orderBy: { coveredAt: "asc" },
  });
  let repaid = 0;
  for (const cover of open) {
    if (repaid + cover.amountFcfa > potFcfa) break;
    const done = await tx.reserveCover.updateMany({
      where: { id: cover.id, repaidAt: null },
      data: { repaidAt: new Date() },
    });
    if (done.count === 0) continue;
    await tx.ledgerEntry.create({
      data: {
        groupId,
        roundId: cover.roundId,
        userId,
        type: "RESERVE_REPAY",
        amountFcfa: cover.amountFcfa,
        note: `cover ${cover.id} from pot`,
      },
    });
    repaid += cover.amountFcfa;
  }
  return repaid;
}

// D69: after a death, what the fund paid for her is nobody's debt.
export async function writeOffCovers(tx: Tx, groupId: string, userId: string, now: Date): Promise<number> {
  const done = await tx.reserveCover.updateMany({
    where: { userId, round: { groupId }, repaidAt: null, writtenOffAt: null },
    data: { writtenOffAt: now },
  });
  return done.count;
}
