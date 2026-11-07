import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { checkCanSkip, extendedDeadline, holdsSeat, type SkipBreak } from "../lib/groupRules.js";
import { currentRoundNumber } from "../lib/schedule.js";
import { notifyMembers } from "./notifyService.js";
import { deadlineAfter, reserveBalance } from "./reserveService.js";

// D104: what happens when a member cannot pay, built on the group's advances
// (D103). One cover order whatever the cause: her own advance, then her pot
// still to come, then the others' advances in proportion; the pot is held only
// when the advances are empty. The cause only changes her record.
//
// "Je ne peux pas payer ce tour": said before the due date, her share is
// covered at once and it is not a late payment, as long as she repays before
// the deadline (7 days, or the next turn if later). At most twice in a cycle,
// never two turns in a row, never while she still owes a cover.
// A deadline that passes unpaid is a missed turn; a second one puts her in
// default: blocked from every group until she repays (DEBT_OUTSTANDING, D69).

const DAY_MS = 24 * 60 * 60 * 1000;

type Facts = { ok: true } | { ok: false; reason: SkipBreak };

async function skipFacts(groupId: string, userId: string, number: number, now: Date): Promise<Facts & { roundId?: string; amountFcfa?: number }> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      rulesVersions: true,
      memberships: { where: { userId } },
      rounds: { orderBy: { number: "asc" }, include: { contributions: { where: { userId } }, reserveCovers: true } },
    },
  });
  const seat = group?.memberships[0];
  if (!group || !seat || !holdsSeat(seat)) throw new AppError("NOT_FOUND", 404);
  if (group.state !== "ACTIVE") return { ok: false, reason: "SKIP_NOT_THIS_ROUND" };
  const rules = group.rulesVersions.find((v) => v.version === group.currentVersion);
  const round = group.rounds.find((r) => r.number === number);
  if (!rules || !round) throw new AppError("NOT_FOUND", 404);

  const current = currentRoundNumber(group.rounds.map((r) => r.dueDate), now);
  const dueEnd = round.dueDate.getTime() + DAY_MS; // her whole due day counts
  const mine = (r: (typeof group.rounds)[number]) => r.reserveCovers.find((c) => c.userId === userId);
  const previous = group.rounds.find((r) => r.number === number - 1);
  const owes = group.rounds.some((r) => {
    const c = mine(r);
    return c && !c.repaidAt && !c.writtenOffAt;
  });
  const facts = {
    roundNumber: number,
    currentRound: current,
    isBeneficiary: round.beneficiaryId === userId,
    alreadyPaid: round.contributions.some((c) => c.status === "PAID"),
    alreadyCovered: Boolean(mine(round)),
    dueDatePassed: now.getTime() >= dueEnd,
    owesCover: owes,
    skipsThisCycle: group.rounds.filter((r) => mine(r)?.askedAt).length,
    skippedPreviousRound: Boolean(previous && mine(previous)?.askedAt),
    advancesFcfa: await reserveBalance(groupId),
    amountFcfa: rules.amountFcfa,
  };
  const result = checkCanSkip(facts);
  return result.ok ? { ok: true, roundId: round.id, amountFcfa: rules.amountFcfa } : result;
}

// Can she press "Je ne peux pas payer ce tour" for this round now?
export async function canSkip(groupId: string, userId: string, number: number, now = new Date()): Promise<boolean> {
  try {
    return (await skipFacts(groupId, userId, number, now)).ok;
  } catch {
    return false;
  }
}

// She said she cannot pay this turn. Her share is covered by the advances at
// once, so the pot of the member whose turn it is stays full.
export async function skipRound(groupId: string, userId: string, number: number, now = new Date()) {
  const facts = await skipFacts(groupId, userId, number, now);
  if (!facts.ok) throw new AppError(facts.reason, 409);
  const roundId = facts.roundId!;
  const amountFcfa = facts.amountFcfa!;

  const cover = await prisma.$transaction(async (tx) => {
    // Checked again inside the transaction: two taps cannot cover twice.
    if ((await reserveBalance(groupId, tx)) < amountFcfa) throw new AppError("SKIP_NO_ADVANCES", 409);
    const dueBy = await deadlineAfter(tx, roundId, now);
    const row = await tx.reserveCover.create({
      data: { roundId, userId, amountFcfa, coveredAt: now, askedAt: now, dueBy },
    });
    await tx.ledgerEntry.create({
      data: { groupId, roundId, userId, type: "RESERVE_COVER", amountFcfa, note: `cover ${row.id} asked` },
    });
    await tx.auditEvent.create({
      data: { userId, type: "COVER_ASKED", details: { groupId, round: number, amountFcfa } },
    });
    return row;
  });

  // The others are told their advances are covering a share, without a name:
  // the group's grid shows who, as a paper tontine would (D104).
  const others = await prisma.membership.findMany({
    where: { groupId, userId: { not: userId }, payoutPosition: { not: null }, exitReason: null },
    select: { userId: true },
  });
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
  await notifyMembers(
    others.map((o) => o.userId),
    "money",
    `/groups/${groupId}?tab=groupe`,
    { title: group.name, body: "Vos avances couvrent une part aujourd'hui. Elles vous reviennent au remboursement." },
    { title: group.name, body: "Your advances cover a share today. They come back when it is repaid." },
  ).catch(() => undefined);
  return { dueBy: cover.dueBy?.toISOString() ?? null, amountFcfa };
}

// The organiser gives a member more time to repay, once per cover, by the
// same length as the first deadline.
export async function extendCover(groupId: string, organiserId: string, memberId: string, now = new Date()) {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { organiserId: true } });
  if (!group) throw new AppError("NOT_FOUND", 404);
  if (group.organiserId !== organiserId) throw new AppError("ORGANISER_ONLY", 403);
  const cover = await prisma.reserveCover.findFirst({
    where: { userId: memberId, round: { groupId }, repaidAt: null, writtenOffAt: null, dueBy: { not: null } },
    orderBy: { dueBy: "asc" },
  });
  if (!cover?.dueBy) throw new AppError("NOT_FOUND", 404);
  if (cover.extendedAt) throw new AppError("COVER_ALREADY_EXTENDED", 409);
  const dueBy = extendedDeadline(cover.coveredAt, cover.dueBy);
  await prisma.reserveCover.update({
    where: { id: cover.id },
    // An extension given after the deadline also lifts the missed turn.
    data: { dueBy, extendedAt: now, missedAt: null },
  });
  await prisma.auditEvent.create({
    data: { userId: organiserId, type: "COVER_EXTENDED", details: { groupId, memberId, dueBy: dueBy.toISOString() } },
  });
  return { dueBy: dueBy.toISOString() };
}

// Run with the payouts: a deadline that passed unpaid is a missed turn; a
// second missed turn in the same group puts her in default.
export async function runCoverDeadlines(now = new Date()): Promise<void> {
  const late = await prisma.reserveCover.findMany({
    where: { repaidAt: null, writtenOffAt: null, missedAt: null, dueBy: { lt: now } },
    include: { round: { select: { groupId: true } } },
  });
  for (const cover of late) {
    await prisma.reserveCover.update({ where: { id: cover.id }, data: { missedAt: now } });
    const missed = await prisma.reserveCover.count({
      where: { userId: cover.userId, round: { groupId: cover.round.groupId }, missedAt: { not: null } },
    });
    if (missed >= 2) {
      await prisma.membership.updateMany({
        where: { groupId: cover.round.groupId, userId: cover.userId, defaultedAt: null },
        data: { defaultedAt: now },
      });
    }
    await prisma.auditEvent.create({
      data: { userId: cover.userId, type: "COVER_MISSED", details: { groupId: cover.round.groupId, missed } },
    });
  }
}
