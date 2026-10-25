import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { decidePayout } from "../lib/groupRules.js";
import { isoDay } from "../lib/schedule.js";
import { payoutSms } from "../lib/smsText.js";
import { mfi, sms } from "../providers/index.js";
import type { PayoutAnswer } from "../providers/mfi/MfiAdapter.js";

// Money out (Sprint 4, D63). On a round's due date, a full pot becomes READY;
// the MFI officer then releases it from the console, and only then does Novi
// instruct the MFI to send it to the member whose turn it is. Novi never holds the money: the MFI
// does, and sends it (D2, D34). This runs as a job every minute, and also
// right after a payment is confirmed, so a held pot leaves as soon as it is
// full. Running it twice at the same moment is safe: each pot is sent once,
// to her own verified number only (D49).

// A transfer that Novi asked for but never heard back about (the API stopped
// mid-request, for example) is asked again after this long. The MFI treats
// the same payoutId as the same transfer, so asking again never sends twice.
const STUCK_AFTER_MS = 10 * 60 * 1000;

export async function runPayouts(now = new Date(), groupId?: string): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: {
      dueDate: { lte: now },
      group: { state: "ACTIVE", ...(groupId ? { id: groupId } : {}) },
      OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
    },
    orderBy: [{ groupId: "asc" }, { number: "asc" }],
    include: { group: true, payout: true, contributions: true, beneficiary: { select: { phone: true } } },
  });

  for (const round of rounds) {
    try {
      await handleRound(round, now);
    } catch (err) {
      // One round's problem never stops the others.
      console.error(`Payout of round ${round.number} of group ${round.groupId} failed:`, err);
    }
  }
}

type DueRound = Prisma.RoundGetPayload<{
  include: { group: true; payout: true; contributions: true; beneficiary: { select: { phone: true } } };
}>;

async function handleRound(round: DueRound, now: Date) {
  // A transfer the MFI accepted earlier: ask how it went.
  if (round.payout?.status === "SENT" && round.payout.mfiRef) {
    await applyAnswer(round.payout.id, await mfi.getPayoutStatus(round.payout.mfiRef));
    return;
  }

  const paid = round.contributions.filter((c) => c.status === "PAID");
  const members = await prisma.membership.count({ where: { groupId: round.groupId, payoutPosition: { not: null } } });
  const decision = decidePayout(round.dueDate, now, paid.length, members);
  if (decision === "WAIT") return;

  // The pot is what was actually collected, and goes to her own number, with
  // the mobile money service she pays with in this group.
  const amountFcfa = paid.reduce((sum, c) => sum + c.amountFcfa, 0);
  const hers = await prisma.contribution.findFirst({
    where: { userId: round.beneficiaryId, status: "PAID", round: { groupId: round.groupId } },
    orderBy: { paidAt: "desc" },
  });
  const details = { amountFcfa, phone: round.beneficiary.phone, operator: hers?.operator ?? ("MOOV_TG" as const) };

  if (decision === "HOLD") {
    if (!round.payout) {
      await createPayoutOnce({
        roundId: round.id,
        beneficiaryId: round.beneficiaryId,
        status: "HELD",
        heldSince: now,
        ...details,
      });
    }
    return;
  }

  // Full and due: the pot waits for the officer's release (D63). A held pot
  // that has just filled up becomes ready the same way.
  if (!round.payout) {
    await createPayoutOnce({ roundId: round.id, beneficiaryId: round.beneficiaryId, status: "READY", ...details });
    return;
  }
  if (round.payout.status === "HELD") {
    await prisma.payout.updateMany({
      where: { id: round.payout.id, status: "HELD" },
      data: { status: "READY", ...details },
    });
    return;
  }
  if (round.payout.status === "READY") return;

  // Released earlier but refused, or stuck without an answer: try again.
  // Claimed first, so two runs at the same moment cannot both instruct the MFI.
  const payoutId = await claimForSending(round, now, details);
  if (payoutId) await sendToMfi(payoutId, round.group.mfiAccountRef, details);
}

// The officer's release (D63): claims a READY pot, records who released it,
// then instructs the MFI. Returns false if the pot was not ready to release.
export async function releasePayout(payoutId: string, staffId: string | null, now = new Date()): Promise<boolean> {
  const claimed = await prisma.payout.updateMany({
    where: { id: payoutId, status: "READY" },
    data: { status: "SENDING", requestedAt: now, releasedAt: now, releasedById: staffId },
  });
  if (claimed.count === 0) return false;

  const payout = await prisma.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { round: { include: { group: true } } },
  });
  await sendToMfi(payoutId, payout.round.group.mfiAccountRef, {
    amountFcfa: payout.amountFcfa,
    phone: payout.phone,
    operator: payout.operator,
  });
  return true;
}

async function sendToMfi(payoutId: string, accountRef: string | null, details: PayoutDetails) {
  if (!accountRef) throw new Error(`payout ${payoutId}: the group has no MFI account`);
  let answer: PayoutAnswer;
  try {
    answer = await mfi.sendPayout({ payoutId, accountRef, ...details });
  } catch (err) {
    console.error(`MFI did not accept payout ${payoutId}:`, err);
    await prisma.payout.update({ where: { id: payoutId }, data: { status: "FAILED" } });
    return;
  }
  await applyAnswer(payoutId, answer);
}

// Her answer once the pot has arrived (D63): received, or not. Only the
// member who received it may answer, once, and only after the MFI paid it.
export async function answerReceipt(userId: string, payoutId: string, received: boolean, now = new Date()) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout || payout.beneficiaryId !== userId) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "PAID" || payout.receiptConfirmedAt || payout.receiptDisputedAt) {
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  await prisma.$transaction([
    prisma.payout.update({
      where: { id: payoutId },
      data: received ? { receiptConfirmedAt: now } : { receiptDisputedAt: now },
    }),
    prisma.auditEvent.create({
      data: { userId, type: received ? "PAYOUT_RECEIPT_CONFIRMED" : "PAYOUT_RECEIPT_DISPUTED", details: { payoutId } },
    }),
  ]);
}

type PayoutDetails = { amountFcfa: number; phone: string; operator: "MOOV_TG" | "TOGOCEL" };

// Creates the round's payout row; the unique roundId makes a second creation
// fail, which simply means another run got there first.
async function createPayoutOnce(data: Prisma.PayoutUncheckedCreateInput): Promise<string | null> {
  try {
    return (await prisma.payout.create({ data })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

// Returns the payout's ID if this run may send it, or null if another run is
// already sending it or it is done.
async function claimForSending(round: DueRound, now: Date, details: PayoutDetails): Promise<string | null> {
  const sending = { status: "SENDING" as const, requestedAt: now, ...details };
  if (!round.payout) return null;
  const claimed = await prisma.payout.updateMany({
    where: {
      id: round.payout.id,
      OR: [{ status: "FAILED" }, { status: "SENDING", requestedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } }],
    },
    data: sending,
  });
  return claimed.count === 1 ? round.payout.id : null;
}

async function applyAnswer(payoutId: string, answer: PayoutAnswer) {
  if (answer.status === "PAID") return settlePayout(payoutId, answer.mfiRef);
  await prisma.payout.updateMany({
    where: { id: payoutId, status: { not: "PAID" } },
    data: { status: answer.status, mfiRef: answer.mfiRef },
  });
}

// The MFI confirmed the money reached her wallet. Like a contribution (D45),
// this is applied once: the update only matches a payout not yet PAID, and
// the ledger accepts one line per payout. When the last round is paid out,
// the cycle is complete (D27).
async function settlePayout(payoutId: string, mfiRef: string) {
  const paidAt = new Date();
  const done = await prisma.$transaction(async (tx) => {
    const moved = await tx.payout.updateMany({
      where: { id: payoutId, status: { not: "PAID" } },
      data: { status: "PAID", mfiRef, paidAt },
    });
    if (moved.count === 0) return null;

    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId }, include: { round: true } });
    await tx.ledgerEntry.create({
      data: {
        groupId: payout.round.groupId,
        roundId: payout.roundId,
        userId: payout.beneficiaryId,
        type: "PAYOUT",
        amountFcfa: payout.amountFcfa,
        payoutId,
      },
    });
    await tx.auditEvent.create({
      data: { userId: payout.beneficiaryId, type: "PAYOUT_PAID", details: { payoutId, round: payout.round.number } },
    });

    const rounds = await tx.round.count({ where: { groupId: payout.round.groupId } });
    const paidOut = await tx.payout.count({ where: { round: { groupId: payout.round.groupId }, status: "PAID" } });
    if (paidOut === rounds) {
      await tx.group.updateMany({
        where: { id: payout.round.groupId, state: "ACTIVE" },
        data: { state: "COMPLETED", completedAt: paidAt },
      });
      await tx.auditEvent.create({ data: { type: "GROUP_COMPLETED", details: { groupId: payout.round.groupId } } });
    }
    return payout;
  });

  if (done) {
    const round = await prisma.round.findUniqueOrThrow({
      where: { id: done.roundId },
      include: { group: { include: { mfi: true } }, beneficiary: { select: { language: true } } },
    });
    await sms.send(
      done.phone,
      payoutSms(round.beneficiary.language, {
        amountFcfa: done.amountFcfa,
        roundNumber: round.number,
        groupName: round.group.name,
        date: isoDay(paidAt),
        mfiName: round.group.mfi.name,
      }),
    );
  }
}

// Runs the payouts every minute while the API is up. The previous run must
// finish before the next starts.
export function startPayoutJob(everyMs = 60_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runPayouts()
      .catch((err: unknown) => console.error("Payout job failed:", err))
      .finally(() => {
        running = false;
      });
  }, everyMs);
}
