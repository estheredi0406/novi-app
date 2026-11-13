import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { advanceOf, repayDeadline, SKIPS_PER_CYCLE } from "../lib/groupRules.js";
import { mfi, sms } from "../providers/index.js";
import { accountForMfi } from "./paymentAccounts.js";
import { advanceBackSms, coverSms } from "../lib/smsText.js";
import { AppError } from "../lib/errors.js";
import { alertStaff } from "./alertService.js";
import { MAX_ATTEMPTS, nextRetryAt } from "./payoutService.js";

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
  "RESERVE_ADVANCE", // D88, removed by D115: lines already written still count
  "RESERVE_ADVANCE_REPAY",
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
// pays first. D149: every part is written at once, in one transaction, then
// sent; the sending is followed like a pot (runReturns). Writing them runs
// once: a second run finds the returns already there and only sends.
export async function returnReserve(groupId: string, now = new Date()): Promise<void> {
  await planReturns(groupId);
  await sendDueReturns(now, groupId);
}

async function planReturns(groupId: string): Promise<void> {
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

  const rows: { userId: string; amount: number; phone: string; operator: "MOOV_TG" | "TOGOCEL" }[] = [];
  for (const part of parts.filter((p) => p.amount > 0)) {
    const where = await payeeOf(groupId, part.userId);
    if (where) rows.push({ ...part, ...where });
  }
  if (rows.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const created = await tx.reserveReturn.create({
        data: {
          groupId,
          userId: row.userId,
          amountFcfa: row.amount,
          phone: row.phone,
          operator: row.operator,
          status: "SENDING",
        },
      });
      await tx.ledgerEntry.create({
        data: {
          groupId,
          userId: row.userId,
          type: "RESERVE_RETURN",
          amountFcfa: row.amount,
          note: `return ${created.id}`,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        type: "RESERVE_RETURNED",
        details: { groupId, amountFcfa: rows.reduce((n, r) => n + r.amount, 0) },
      },
    });
  });
}

// Where her part goes: her own number, or after she left or died, the number
// the officer recorded (D69). Read again before each try, so a number an
// officer corrected is the one used.
async function payeeOf(groupId: string, userId: string) {
  const seat = await prisma.membership.findFirst({
    where: { groupId, userId },
    select: { exitPayoutPhone: true, user: { select: { phone: true } } },
  });
  const phone = seat?.exitPayoutPhone ?? seat?.user.phone ?? "";
  if (!phone) return null;
  const last = await prisma.contribution.findFirst({
    where: { userId, status: "PAID", round: { groupId } },
    orderBy: { paidAt: "desc" },
  });
  return { phone, operator: last?.operator ?? ("MOOV_TG" as const) };
}

// D149: a part not yet asked for, asked but never answered, or refused and
// whose wait is over, is (re)sent; one the sender accepted is asked how it
// went. Also writes the parts of any finished group whose advances were never
// given back (the API stopped at the wrong moment, for example).
export async function runReturns(now = new Date()): Promise<void> {
  const forgotten = await prisma.group.findMany({
    where: { state: "COMPLETED", mfiAccountRef: { not: null }, reserveReturns: { none: {} } },
    select: { id: true },
    take: 50,
  });
  for (const g of forgotten) {
    await planReturns(g.id).catch((err: unknown) => console.error(`Advances of group ${g.id} not written:`, err));
  }
  await sendDueReturns(now);
  const accepted = await prisma.reserveReturn.findMany({
    where: { status: "SENT", mfiRef: { not: null } },
    include: { group: { select: { mfiId: true } } },
    take: 200,
  });
  for (const row of accepted) {
    try {
      const sender = await senderFor(row.group.mfiId, row.sentVia);
      await applyReturnAnswer(row.id, await sender.getPayoutStatus(row.mfiRef as string), now);
    } catch (err) {
      console.error(`Status of advance return ${row.id} not read:`, err);
    }
  }
}

const RETURN_STUCK_MS = 10 * 60 * 1000;

async function sendDueReturns(now: Date, groupId?: string): Promise<void> {
  const rows = await prisma.reserveReturn.findMany({
    where: {
      ...(groupId ? { groupId } : {}),
      OR: [
        { status: "SENDING", requestedAt: null },
        { status: "SENDING", requestedAt: { lt: new Date(now.getTime() - RETURN_STUCK_MS) } },
        { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  for (const row of rows) {
    if (row.status === "FAILED") {
      const at = nextRetryAt(row);
      if (!at || at > now) continue;
    }
    try {
      await sendReturn(row, now);
    } catch (err) {
      console.error(`Advance return ${row.id} not sent:`, err);
    }
  }
}

async function senderFor(mfiId: string, sentVia: string | null) {
  if (sentVia === "mfi") return mfi;
  // D102: from the MFI's own FedaPay balance, like the pots.
  const account = await accountForMfi(mfiId).catch(() => null);
  if (sentVia === "fedapay" && !account) throw new Error("FedaPay account not reachable");
  return account?.sentVia === "fedapay" ? account.payouts : mfi;
}

async function sendReturn(
  row: { id: string; groupId: string; userId: string; status: string; attempts: number; requestedAt: Date | null },
  now: Date,
): Promise<void> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: row.groupId } });
  if (!group.mfiAccountRef) return;
  const payee = await payeeOf(row.groupId, row.userId);
  if (!payee) return;
  const account = await accountForMfi(group.mfiId).catch(() => null);
  const sentVia = account?.sentVia === "fedapay" ? "fedapay" : "mfi";
  // Claimed once: two runs never send the same part at the same moment.
  const claimed = await prisma.reserveReturn.updateMany({
    where: { id: row.id, status: row.status as "SENDING" | "FAILED", attempts: row.attempts, requestedAt: row.requestedAt },
    data: { status: "SENDING", requestedAt: now, attempts: { increment: 1 }, sentVia, ...payee },
  });
  if (claimed.count === 0) return;
  let answer: { status: "PAID" | "SENT" | "FAILED"; mfiRef: string | null };
  try {
    const sender = sentVia === "fedapay" && account ? account.payouts : mfi;
    answer = await sender.sendPayout({
      payoutId: row.id,
      accountRef: group.mfiAccountRef,
      amountFcfa: (await prisma.reserveReturn.findUniqueOrThrow({ where: { id: row.id } })).amountFcfa,
      phone: payee.phone,
      operator: payee.operator,
    });
  } catch (err) {
    console.error(`MFI did not accept advance return ${row.id}:`, err);
    answer = { status: "FAILED", mfiRef: null };
  }
  await applyReturnAnswer(row.id, answer, now);
}

async function applyReturnAnswer(
  id: string,
  answer: { status: "PAID" | "SENT" | "FAILED"; mfiRef: string | null },
  now: Date,
): Promise<void> {
  if (answer.status === "PAID") {
    const moved = await prisma.reserveReturn.updateMany({
      where: { id, status: { not: "PAID" } },
      data: { status: "PAID", paidAt: now, ...(answer.mfiRef ? { mfiRef: answer.mfiRef } : {}) },
    });
    if (moved.count > 0) await tellReturned(id, now);
    return;
  }
  const moved = await prisma.reserveReturn.updateMany({
    where: { id, status: { not: "PAID" } },
    data: {
      status: answer.status,
      ...(answer.mfiRef ? { mfiRef: answer.mfiRef } : {}),
      ...(answer.status === "FAILED" ? { failedAt: now } : {}),
    },
  });
  if (moved.count > 0 && answer.status === "FAILED") await alertIfReturnStuck(id);
}

// D149: she is told once, by SMS, when her part reached her.
async function tellReturned(id: string, now: Date): Promise<void> {
  const told = await prisma.reserveReturn.updateMany({ where: { id, toldAt: null }, data: { toldAt: now } });
  if (told.count === 0) return;
  const row = await prisma.reserveReturn.findUniqueOrThrow({
    where: { id },
    include: { group: { select: { name: true } }, user: { select: { language: true } } },
  });
  await sms
    .send(row.phone, advanceBackSms(row.user.language, { amountFcfa: row.amountFcfa, groupName: row.group.name }))
    .catch((err: unknown) => console.error("Advance return SMS failed:", err));
}

// D149: the automatic tries are used up: the officers are told once, like a pot.
async function alertIfReturnStuck(id: string): Promise<void> {
  const row = await prisma.reserveReturn.findUnique({
    where: { id },
    include: { group: { select: { id: true, name: true, mfiId: true } } },
  });
  if (!row || row.status !== "FAILED" || row.attempts < MAX_ATTEMPTS) return;
  await alertStaff({
    mfiId: row.group.mfiId,
    kind: "RETURN_FAILED",
    refId: id,
    groupId: row.group.id,
    subject: `Avance non rendue : ${row.group.name}`,
    lines: [
      `Le groupe « ${row.group.name} » est terminé, mais l'avance à rendre à une membre (${row.amountFcfa} FCFA) a été refusée ${row.attempts} fois.`,
      "Vérifiez son numéro et son compte mobile money, puis relancez l'envoi depuis la page du groupe.",
    ],
  });
}

// D149: the officer's retry, from the group page: one more try for every part
// of this group that was refused, now, even after the automatic tries.
export async function retryReturns(mfiId: string, staffId: string, groupId: string, now = new Date()): Promise<number> {
  const group = await prisma.group.findFirst({ where: { id: groupId, mfiId } });
  if (!group) throw new AppError("NOT_FOUND", 404);
  const failed = await prisma.reserveReturn.findMany({ where: { groupId, status: "FAILED" } });
  if (failed.length === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.auditEvent.create({
    data: { type: "STAFF_RETURN_RETRY", details: { staffId, groupId, returns: failed.length } },
  });
  for (const row of failed) {
    await prisma.reserveReturn.updateMany({
      where: { id: row.id, status: "FAILED" },
      data: { failedAt: new Date(0), attempts: Math.min(row.attempts, MAX_ATTEMPTS - 1) },
    });
  }
  await sendDueReturns(now, groupId);
  return failed.length;
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
