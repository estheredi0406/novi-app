import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { decidePayout, potShare } from "../lib/groupRules.js";
import { runCoverDeadlines } from "./advanceService.js";
import { isoDay } from "../lib/schedule.js";
import { payoutSms } from "../lib/smsText.js";
import { mfi, sms } from "../providers/index.js";
import { accountForMfi } from "./paymentAccounts.js";
import { syncCoreBanking } from "./coreBanking.js";
import type { PayoutAnswer } from "../providers/mfi/MfiAdapter.js";
import { deleteGroupVoices, postEvent } from "./chatService.js";
import { alertStaff } from "./alertService.js";
import { notifyCycleDone, notifyPotPaid } from "./notifyService.js";
import { coverMissing, repayFromPot, returnReserve } from "./reserveService.js";

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

export async function runPayouts(
  now = new Date(),
  groupId?: string,
): Promise<void> {
  // D104: deadlines of covered shares that passed unpaid.
  await runCoverDeadlines(now).catch((err) => console.error("Cover deadlines failed:", err));
  const rounds = await prisma.round.findMany({
    where: {
      dueDate: { lte: now },
      group: { state: "ACTIVE", ...(groupId ? { id: groupId } : {}) },
      OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
    },
    orderBy: [{ groupId: "asc" }, { number: "asc" }],
    include: {
      group: true,
      payout: true,
      contributions: true,
      beneficiary: { select: { phone: true } },
    },
  });

  for (const round of rounds) {
    try {
      await handleRound(round, now);
    } catch (err) {
      // One round's problem never stops the others.
      console.error(
        `Payout of round ${round.number} of group ${round.groupId} failed:`,
        err,
      );
    }
  }
  // D113: the MFI's books follow every pot paid and every advance returned.
  await syncCoreBanking().catch((err) => console.error("Core banking booking failed:", err));
}

// Each member's contribution under the group's current rules.
async function contributionOf(groupId: string): Promise<number> {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { rulesVersions: true },
  });
  return (
    group.rulesVersions.find((v) => v.version === group.currentVersion)
      ?.amountFcfa ?? 0
  );
}

type DueRound = Prisma.RoundGetPayload<{
  include: {
    group: true;
    payout: true;
    contributions: true;
    beneficiary: { select: { phone: true } };
  };
}>;

async function handleRound(round: DueRound, now: Date) {
  // A transfer the MFI accepted earlier: ask how it went.
  if (round.payout?.status === "SENT" && round.payout.mfiRef) {
    // D102: asked of the account that sent it.
    const sender =
      round.payout.sentVia === "fedapay"
        ? (await accountForMfi(round.group.mfiId)).payouts
        : mfi;
    await applyAnswer(round.payout.id, await sender.getPayoutStatus(round.payout.mfiRef));
    return;
  }

  const paid = round.contributions.filter((c) => c.status === "PAID");
  const members = await prisma.membership.count({
    where: { groupId: round.groupId, payoutPosition: { not: null } },
  });
  // A share covered by the advances counts once: if she then paid the same
  // round herself (D104), her payment counts and the cover is repaid.
  const paidBy = new Set(paid.map((c) => c.userId));
  const unpaidCovers = (rows: { userId: string; amountFcfa: number }[]) =>
    rows.filter((c) => !paidBy.has(c.userId));
  let covers = unpaidCovers(
    await prisma.reserveCover.findMany({ where: { roundId: round.id } }),
  );
  let decision = decidePayout(
    round.dueDate,
    now,
    paid.length + covers.length,
    members,
  );
  if (decision === "WAIT") return;

  // D104: payments are missing on the due date; the group's advances pay
  // the missing shares if they can, and the pot leaves full.
  if (
    decision === "HOLD" &&
    (!round.payout || round.payout.status === "HELD")
  ) {
    const amount = paid[0]
      ? paid[0].amountFcfa - paid[0].advanceFcfa
      : await contributionOf(round.groupId);
    if (await coverMissing(round, amount, now)) {
      covers = unpaidCovers(
        await prisma.reserveCover.findMany({ where: { roundId: round.id } }),
      );
      decision = "SEND";
    }
  }

  // The pot is each paid contribution less the reserve's share, plus what the
  // reserve covered. It goes to her own number, with the mobile money
  // service she pays with in this group.
  // Once the officer released it, what her pot repaid to the fund is no
  // longer part of what is sent (D69).
  const amountFcfa =
    paid.reduce((sum, c) => sum + potShare(c.amountFcfa - c.advanceFcfa), 0) +
    covers.reduce((sum, c) => sum + c.amountFcfa, 0) -
    (round.payout?.coverRepaidFcfa ?? 0);
  const hers = await prisma.contribution.findFirst({
    where: {
      userId: round.beneficiaryId,
      status: "PAID",
      round: { groupId: round.groupId },
    },
    orderBy: { paidAt: "desc" },
  });
  // D69: after she left or died, the pot goes to the number the officer
  // recorded: her next of kin's after a death.
  const seat = await prisma.membership.findFirst({
    where: { groupId: round.groupId, userId: round.beneficiaryId },
    select: { exitReason: true, exitPayoutPhone: true },
  });
  const details = {
    amountFcfa,
    phone: seat?.exitPayoutPhone ?? round.beneficiary.phone,
    operator: hers?.operator ?? ("MOOV_TG" as const),
    toNextOfKin: seat?.exitReason === "DEATH",
  };

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

  // Full and due: the pot becomes ready (D63). A held pot that has just
  // filled up becomes ready the same way. D105: up to the MFI's limit it then
  // leaves at once, with no officer; above it, the officers are told, and two
  // of them approve it in the console.
  const limit = await autoReleaseLimit(round.group.mfiId);
  let readyId: string | null = null;
  if (!round.payout) {
    readyId = await createPayoutOnce({
      roundId: round.id,
      beneficiaryId: round.beneficiaryId,
      status: "READY",
      ...details,
    });
  } else if (round.payout.status === "HELD") {
    const moved = await prisma.payout.updateMany({
      where: { id: round.payout.id, status: "HELD" },
      data: { status: "READY", ...details },
    });
    if (moved.count === 1) readyId = round.payout.id;
  } else if (round.payout.status === "READY") {
    // Already waiting for the officers: it leaves by itself only if the
    // admin has since raised the limit above it, and nobody approved it yet.
    if (leavesAlone(details.amountFcfa, limit) && !round.payout.firstApprovedById)
      await autoRelease(round.payout.id, limit);
    return;
  }
  if (readyId) {
    if (leavesAlone(details.amountFcfa, limit)) await autoRelease(readyId, limit);
    else await alertPotReady(round, readyId, details.amountFcfa);
  }
  if (!round.payout || round.payout.status === "HELD") return;

  // Released earlier but refused, or stuck without an answer: try again.
  // Claimed first, so two runs at the same moment cannot both instruct the MFI.
  const payoutId = await claimForSending(round, now, details);
  if (payoutId) await sendToMfi(payoutId, round.group.mfiAccountRef, details);
}

// D105: the amount up to which a full pot leaves without an officer; null
// when the MFI turned this off and an officer releases every pot (D63).
export async function autoReleaseLimit(mfiId: string): Promise<number | null> {
  const found = await prisma.mfi.findUnique({ where: { id: mfiId }, select: { autoReleaseFcfa: true } });
  return found?.autoReleaseFcfa ?? null;
}

// D105: does this pot leave by itself, or does it need two officers?
export const leavesAlone = (amountFcfa: number, limit: number | null) => limit !== null && amountFcfa <= limit;
export const needsTwoOfficers = (amountFcfa: number, limit: number | null) => limit !== null && amountFcfa > limit;

// D105: released by Novi under the MFI's own limit, logged as such; no
// officer's name, because none was needed.
async function autoRelease(payoutId: string, limit: number | null) {
  if (await releasePayout(payoutId, null)) {
    await prisma.auditEvent.create({
      data: { type: "PAYOUT_AUTO_RELEASED", details: { payoutId, limitFcfa: limit } },
    });
  }
}

// The officer's release (D63): claims a READY pot, records who released it,
// then instructs the MFI. Returns false if the pot was not ready to release.
export async function releasePayout(
  payoutId: string,
  staffId: string | null,
  now = new Date(),
): Promise<boolean> {
  const claimed = await prisma.$transaction(async (tx) => {
    const moved = await tx.payout.updateMany({
      where: { id: payoutId, status: "READY" },
      data: {
        status: "SENDING",
        requestedAt: now,
        releasedAt: now,
        releasedById: staffId,
      },
    });
    if (moved.count === 0) return false;
    // D69: her own unpaid covers in this group are repaid from her pot first.
    const payout = await tx.payout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { round: true },
    });
    const repaid = await repayFromPot(
      tx,
      payout.round.groupId,
      payout.beneficiaryId,
      payout.amountFcfa,
    );
    if (repaid > 0) {
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          amountFcfa: payout.amountFcfa - repaid,
          coverRepaidFcfa: repaid,
        },
      });
    }
    return true;
  });
  if (!claimed) return false;

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

async function sendToMfi(
  payoutId: string,
  accountRef: string | null,
  details: PayoutDetails,
) {
  if (!accountRef)
    throw new Error(`payout ${payoutId}: the group has no MFI account`);
  let answer: PayoutAnswer;
  try {
    const { amountFcfa, phone, operator } = details;
    // D102: from the MFI's own FedaPay balance when it connected one and
    // sends pots that way; otherwise through the MFI stand-in (D49).
    const { mfiId } = await prisma.payout
      .findUniqueOrThrow({ where: { id: payoutId }, select: { round: { select: { group: { select: { mfiId: true } } } } } })
      .then((p) => p.round.group);
    const account = await accountForMfi(mfiId).catch(() => null);
    const sender = account?.sentVia === "fedapay" ? account.payouts : mfi;
    await prisma.payout.update({
      where: { id: payoutId },
      data: { sentVia: account?.sentVia === "fedapay" ? "fedapay" : "mfi" },
    });
    answer = await sender.sendPayout({
      payoutId,
      accountRef,
      amountFcfa,
      phone,
      operator,
    });
  } catch (err) {
    console.error(`MFI did not accept payout ${payoutId}:`, err);
    await prisma.payout.update({
      where: { id: payoutId },
      data: { status: "FAILED" },
    });
    return;
  }
  await applyAnswer(payoutId, answer);
}

// Her answer once the pot has arrived (D63): received, or not. Only the
// member who received it may answer, once, and only after the MFI paid it.
export async function answerReceipt(
  userId: string,
  payoutId: string,
  received: boolean,
  now = new Date(),
) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout || payout.beneficiaryId !== userId)
    throw new AppError("NOT_FOUND", 404);
  if (
    payout.status !== "PAID" ||
    payout.receiptConfirmedAt ||
    payout.receiptDisputedAt
  ) {
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  await prisma.$transaction([
    prisma.payout.update({
      where: { id: payoutId },
      data: received ? { receiptConfirmedAt: now } : { receiptDisputedAt: now },
    }),
    prisma.auditEvent.create({
      data: {
        userId,
        type: received ? "PAYOUT_RECEIPT_CONFIRMED" : "PAYOUT_RECEIPT_DISPUTED",
        details: { payoutId },
      },
    }),
  ]);
  if (!received) {
    const round = await prisma.round.findUnique({
      where: { id: payout.roundId },
      include: { group: true },
    });
    if (round) {
      await alertStaff({
        mfiId: round.group.mfiId,
        kind: "POT_DISPUTED",
        refId: payoutId,
        groupId: round.groupId,
        subject: `Cagnotte non reçue : ${round.group.name}, tour ${round.number}`,
        lines: [
          `La bénéficiaire du tour ${round.number} de « ${round.group.name} » dit ne pas avoir reçu sa cagnotte.`,
          "Vérifiez ce transfert dans votre système.",
        ],
      });
    }
  }
}

type PayoutDetails = {
  amountFcfa: number;
  phone: string;
  operator: "MOOV_TG" | "TOGOCEL";
  toNextOfKin?: boolean;
};

// Creates the round's payout row; the unique roundId makes a second creation
// fail, which simply means another run got there first.
async function createPayoutOnce(
  data: Prisma.PayoutUncheckedCreateInput,
): Promise<string | null> {
  try {
    return (await prisma.payout.create({ data })).id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    )
      return null;
    throw err;
  }
}

// Returns the payout's ID if this run may send it, or null if another run is
// already sending it or it is done.
async function claimForSending(
  round: DueRound,
  now: Date,
  details: PayoutDetails,
): Promise<string | null> {
  const sending = { status: "SENDING" as const, requestedAt: now, ...details };
  if (!round.payout) return null;
  const claimed = await prisma.payout.updateMany({
    where: {
      id: round.payout.id,
      OR: [
        { status: "FAILED" },
        {
          status: "SENDING",
          requestedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
        },
      ],
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

    const payout = await tx.payout.findUniqueOrThrow({
      where: { id: payoutId },
      include: { round: true },
    });
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
      data: {
        userId: payout.beneficiaryId,
        type: "PAYOUT_PAID",
        details: { payoutId, round: payout.round.number },
      },
    });

    const rounds = await tx.round.count({
      where: { groupId: payout.round.groupId },
    });
    const paidOut = await tx.payout.count({
      where: { round: { groupId: payout.round.groupId }, status: "PAID" },
    });
    if (paidOut === rounds) {
      await tx.group.updateMany({
        where: { id: payout.round.groupId, state: "ACTIVE" },
        data: { state: "COMPLETED", completedAt: paidAt },
      });
      await tx.auditEvent.create({
        data: {
          type: "GROUP_COMPLETED",
          details: { groupId: payout.round.groupId },
        },
      });
    }
    return payout;
  });

  if (done) {
    // D68: the last pot closed the cycle; what is left in the reserve goes back.
    await returnReserve(done.round.groupId).catch((err: unknown) =>
      console.error("Reserve return failed:", err),
    );
    // The voice notes go with the cycle; the written chat stays.
    const closed = await prisma.group.findUnique({
      where: { id: done.round.groupId },
      select: { state: true },
    });
    if (closed?.state === "COMPLETED") {
      await deleteGroupVoices(done.round.groupId).catch((err: unknown) =>
        console.error("Voice notes not deleted:", err),
      );
      // D80: each member says whether she goes again.
      await notifyCycleDone(done.round.groupId);
    }
    // D70: the group's chat shows whose pot was paid.
    await postEvent(
      done.round.groupId,
      "POT_PAID",
      done.beneficiaryId,
      done.round.number,
    );
    const round = await prisma.round.findUniqueOrThrow({
      where: { id: done.roundId },
      include: {
        group: { include: { mfi: true } },
        beneficiary: { select: { language: true } },
      },
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
    // D79: and on her phone, if Novi is installed.
    await notifyPotPaid(
      done.beneficiaryId,
      round.groupId,
      round.group.name,
      done.amountFcfa,
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

// D90: a pot is full and due; the officers are told to release it.
async function alertPotReady(
  round: {
    number: number;
    groupId: string;
    group: { name: string; mfiId: string };
  },
  payoutId: string,
  amountFcfa: number,
) {
  const amount = `${String(amountFcfa).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
  await alertStaff({
    mfiId: round.group.mfiId,
    kind: "POT_READY",
    refId: payoutId,
    groupId: round.groupId,
    subject: `Cagnotte à libérer : ${round.group.name}, tour ${round.number}`,
    lines: [
      `La cagnotte du tour ${round.number} de « ${round.group.name} » est complète (${amount}).`,
      "La bénéficiaire attend que vous la libériez.",
    ],
  });
}
