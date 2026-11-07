import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { advanceOf, repayDeadline, SKIPS_PER_CYCLE } from "../lib/groupRules.js";
import { mfi, sms } from "../providers/index.js";
import { coverSms } from "../lib/smsText.js";

// The group's advances (D103, D104), which replaced the 2% solidarity reserve
// of D68. Each member pays an advance of half a contribution with round 1;
// the advances stay at the MFI, in this group only (no pooling across groups).
// When a share is missing, the advances pay it so the pot leaves full, and the
// member owes it until she repays (her late payment, or her own pot first).
// At the end of the cycle, what the advances hold goes back to the members who
// owe nothing, in proportion to what each put in: so a member who owes loses
// her own advance first, and only a larger loss is shared by the others.
// Every movement is a ledger line; the line types keep their D68 names.

type Tx = Prisma.TransactionClient;

// Called in the same transaction that credits a contribution, so the
// reserve's share is written exactly once (D45). If the reserve had covered
// her for this round, her payment repays it.
export async function creditReserve(
  tx: Tx,
  contribution: {
    id: string;
    roundId: string;
    userId: string;
    amountFcfa: number;
    advanceFcfa: number;
  },
  groupId: string,
): Promise<void> {
  // D103: the advance paid with round 1 goes into the group's advances.
  const share = contribution.advanceFcfa;
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
    where: {
      roundId_userId: {
        roundId: contribution.roundId,
        userId: contribution.userId,
      },
    },
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

const RESERVE_TYPES = [
  "RESERVE_IN",
  "RESERVE_COVER",
  "RESERVE_REPAY",
  "RESERVE_RETURN",
  "RESERVE_ADVANCE", // D88: out to a member, as an advance
  "RESERVE_ADVANCE_REPAY", // D88: back from her pot
] as const;
type Db = Tx | typeof prisma;

async function sumReserve(
  where: Prisma.LedgerEntryWhereInput,
  db: Db,
): Promise<number> {
  const sums = await db.ledgerEntry.groupBy({
    by: ["type"],
    where: { ...where, type: { in: [...RESERVE_TYPES] } },
    _sum: { amountFcfa: true },
  });
  const of = (type: string) =>
    sums.find((s) => s.type === type)?._sum.amountFcfa ?? 0;
  return (
    of("RESERVE_IN") +
    of("RESERVE_REPAY") +
    of("RESERVE_ADVANCE_REPAY") -
    of("RESERVE_COVER") -
    of("RESERVE_RETURN") -
    of("RESERVE_ADVANCE")
  );
}

// What the group's advances hold now: what was put in, less what they paid
// for members and was not repaid yet, less advances to members (D88).
export function reserveBalance(
  groupId: string,
  db: Db = prisma,
): Promise<number> {
  return sumReserve({ groupId }, db);
}

// Every group's advances at one MFI, added up: shown to the MFI, never used
// to cover another group's share (D103).
export function fundBalance(mfiId: string, db: Db = prisma): Promise<number> {
  return sumReserve({ group: { mfiId } }, db);
}

// On or after a round's due date, with payments missing: if the group's
// advances can pay every missing share, they do, in one transaction, and the
// round is treated as full. Returns false (nothing written) when they cannot,
// and the pot is held (D48). Round 1 is never covered: it carries the advances
// themselves, so the group only really starts once everyone has paid it.
export async function coverMissing(
  round: { id: string; groupId: string; number?: number },
  amountFcfa: number,
  now: Date,
): Promise<boolean> {
  const net = amountFcfa;
  if (round.number === 1) return false;
  // Members told by SMS once the covers are written: not the one whose turn
  // it is (her pot repays it), not a member who died.
  let toTell: string[] = [];
  let tellBy: Date | null = null;
  const ok = await prisma.$transaction(async (tx) => {
    const seats = await tx.membership.findMany({
      where: { groupId: round.groupId, payoutPosition: { not: null } },
      select: { userId: true },
    });
    const paid = await tx.contribution.findMany({
      where: { roundId: round.id, status: "PAID" },
      select: { userId: true },
    });
    const covered = await tx.reserveCover.findMany({
      where: { roundId: round.id },
      select: { userId: true },
    });
    const settled = new Set([...paid, ...covered].map((x) => x.userId));
    const missing = seats.filter((s) => !settled.has(s.userId));
    if (missing.length === 0) return true;
    // D104: the member whose turn it is does not need the advances: her
    // share is taken from her own pot when it is released.
    const receiver = (
      await tx.round.findUniqueOrThrow({ where: { id: round.id }, select: { beneficiaryId: true } })
    ).beneficiaryId;
    const needed = missing.filter((m) => m.userId !== receiver).length * net;
    if ((await reserveBalance(round.groupId, tx)) < needed) return false;
    const dueBy = await deadlineAfter(tx, round.id, now);

    // D69, D104: after a death, nothing is held against her. If her pot is
    // still to come, it repays her shares; if she had already received it,
    // nobody owes them and the group's advances carry them.
    const received = new Set(
      (
        await tx.payout.findMany({
          where: { round: { groupId: round.groupId }, status: "PAID" },
          select: { beneficiaryId: true },
        })
      ).map((p) => p.beneficiaryId),
    );
    const dead = (
      await tx.membership.findMany({
        where: { groupId: round.groupId, exitReason: "DEATH" },
        select: { userId: true },
      })
    ).map((m) => m.userId);
    const deceased = new Set(dead.filter((id) => received.has(id)));
    toTell = missing.map((m) => m.userId).filter((id) => id !== receiver && !dead.includes(id));
    tellBy = dueBy;
    for (const { userId } of missing) {
      const cover = await tx.reserveCover.create({
        data: {
          roundId: round.id,
          userId,
          amountFcfa: net,
          coveredAt: now,
          dueBy,
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
        details: {
          roundId: round.id,
          members: missing.length,
          amountFcfa: missing.length * net,
        },
      },
    });
    return true;
  });
  if (ok && toTell.length > 0 && tellBy) await tellCovered(round.id, toTell, net, tellBy);
  return ok;
}

// D104: an SMS to each member whose share the advances paid without her
// asking, with what to repay and by when.
async function tellCovered(roundId: string, userIds: string[], amountFcfa: number, dueBy: Date) {
  const round = await prisma.round.findUniqueOrThrow({
    where: { id: roundId },
    select: { number: true, group: { select: { name: true } } },
  });
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { phone: true, language: true } });
  for (const user of users) {
    await sms
      .send(
        user.phone,
        coverSms(user.language, {
          amountFcfa,
          roundNumber: round.number,
          groupName: round.group.name,
          dueBy: dueBy.toISOString().slice(0, 10),
        }),
      )
      .catch((err: unknown) => console.error("Cover SMS failed:", err));
  }
}

// D104: when a covered share must be repaid: 7 days, or the next turn's day
// if that is later.
export async function deadlineAfter(tx: Tx, roundId: string, now: Date): Promise<Date> {
  const round = await tx.round.findUniqueOrThrow({ where: { id: roundId } });
  const next = await tx.round.findFirst({
    where: { groupId: round.groupId, number: round.number + 1 },
    select: { dueDate: true },
  });
  return repayDeadline(now, next?.dueDate ?? null);
}

// At the end of the cycle (D103): what the advances hold goes back, through
// the MFI, to the members who owe nothing, in proportion to what each put in.
// A member who still owes a covered round gets nothing back: her own advance
// pays first. Run once: a second run finds the returns already written.
export async function returnReserve(groupId: string): Promise<void> {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
  });
  if (group.state !== "COMPLETED" || !group.mfiAccountRef) return;
  if ((await prisma.reserveReturn.count({ where: { groupId } })) > 0) return;

  // Shares written off after a death are carried by the group's advances
  // (D104): there is no MFI-wide fund any more.
  const balance = await reserveBalance(groupId);
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
        data: {
          groupId,
          userId: part.userId,
          amountFcfa: part.amount,
          phone: user.phone,
          operator,
          status: "SENDING",
        },
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
        data: {
          status: answer.status,
          mfiRef: answer.mfiRef,
          paidAt: answer.status === "PAID" ? new Date() : null,
        },
      });
    } catch (err) {
      console.error(`MFI did not accept reserve return ${created.id}:`, err);
      await prisma.reserveReturn.update({
        where: { id: created.id },
        data: { status: "FAILED" },
      });
    }
  }
  await prisma.auditEvent.create({
    data: {
      type: "RESERVE_RETURNED",
      details: { groupId, amountFcfa: balance },
    },
  });
}

// What a member or an officer sees of the group's advances (D103). With a
// member, also her own part: her advance, what she owes, her deadline.
export async function reserveSummary(groupId: string, _mfiId: string, userId?: string, amountFcfa = 0) {
  const [balance, open, putIn] = await Promise.all([
    reserveBalance(groupId),
    prisma.reserveCover.aggregate({
      where: { round: { groupId }, repaidAt: null, writtenOffAt: null },
      _sum: { amountFcfa: true },
      _count: true,
    }),
    prisma.ledgerEntry.groupBy({
      by: ["userId"],
      where: { groupId, type: "RESERVE_IN" },
      _sum: { amountFcfa: true },
    }),
  ]);
  const totalIn = putIn.reduce((sum, p) => sum + (p._sum.amountFcfa ?? 0), 0);
  const paid = putIn.find((p) => p.userId === userId)?._sum.amountFcfa ?? 0;
  const [mineOpen, asked, seat] = userId
    ? await Promise.all([
        prisma.reserveCover.findMany({
          where: { userId, round: { groupId }, repaidAt: null, writtenOffAt: null },
          orderBy: { dueBy: "asc" },
        }),
        prisma.reserveCover.count({ where: { userId, round: { groupId }, askedAt: { not: null } } }),
        prisma.membership.findFirst({ where: { groupId, userId }, select: { defaultedAt: true } }),
      ])
    : [[], 0, null];
  return {
    percent: 0,
    balanceFcfa: balance,
    fundFcfa: balance,
    owedFcfa: open._sum.amountFcfa ?? 0,
    coversOpen: open._count,
    advanceFcfa: advanceOf(amountFcfa),
    mine: {
      paidFcfa: paid,
      nowFcfa: totalIn > 0 ? Math.max(0, Math.floor((paid * Math.min(balance, totalIn)) / totalIn)) : 0,
      owedFcfa: mineOpen.reduce((sum, c) => sum + c.amountFcfa, 0),
      dueBy: mineOpen[0]?.dueBy?.toISOString() ?? null,
      skipsLeft: Math.max(0, SKIPS_PER_CYCLE - asked),
      defaulted: Boolean(seat?.defaultedAt),
    },
  };
}

// D69: before her pot leaves, what the fund paid for her in this group and
// she has not paid back is taken from it first, so a member cannot collect
// the pot and leave her debt behind. Runs inside the release transaction;
// returns what was repaid.
export async function repayFromPot(
  tx: Tx,
  groupId: string,
  userId: string,
  potFcfa: number,
): Promise<number> {
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
  // D88: then the advance she received from the fund in this group.
  const advances = await tx.advance.findMany({
    where: { userId, groupId, status: "PAID" },
    orderBy: { createdAt: "asc" },
  });
  for (const advance of advances) {
    if (repaid + advance.amountFcfa > potFcfa) break;
    const done = await tx.advance.updateMany({
      where: { id: advance.id, status: "PAID" },
      data: { status: "REPAID", repaidAt: new Date() },
    });
    if (done.count === 0) continue;
    await tx.ledgerEntry.create({
      data: {
        groupId,
        userId,
        type: "RESERVE_ADVANCE_REPAY",
        amountFcfa: advance.amountFcfa,
        note: `advance ${advance.id} from pot`,
      },
    });
    repaid += advance.amountFcfa;
  }
  return repaid;
}

// D69: after a death, what the fund paid for her is nobody's debt.
export async function writeOffCovers(
  tx: Tx,
  groupId: string,
  userId: string,
  now: Date,
): Promise<number> {
  const done = await tx.reserveCover.updateMany({
    where: { userId, round: { groupId }, repaidAt: null, writtenOffAt: null },
    data: { writtenOffAt: now },
  });
  return done.count;
}
