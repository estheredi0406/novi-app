// Pots: releasing them, the automatic release limit, retrying a transfer, and
// payments a member says left her account (D105, D110).

import type { AttentionItem, ConsoleReported } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { creditFoundPayment, rejectReport } from "../moneyService.js";
import {
  MAX_ATTEMPTS,
  autoReleaseLimit,
  needsTwoOfficers,
  releasePayout,
  runPayouts,
} from "../payoutService.js";
import { savingsToOpen } from "../savingsService.js";
import { mfi } from "../../providers/index.js";
import { listAttention } from "./today.js";

// The officer releases a full, due pot (D63): only then does Novi instruct
// the MFI to send it. Logged with her name, like every officer action.
export async function releaseRoundPayout(
  mfiId: string,
  staffId: string,
  payoutId: string,
): Promise<AttentionItem[]> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, round: { group: { mfiId } } },
    include: { round: { select: { number: true } } },
  });
  if (!payout) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "READY") throw new AppError("NOT_ALLOWED_NOW", 409);
  if ((await savingsToOpen(payoutId)) > 0) throw new AppError("SAVINGS_ACCOUNT_TO_OPEN", 409);

  // D105: above the MFI's limit, a first officer approves and a second,
  // different one releases. Each step is logged with the officer's name.
  if (needsTwoOfficers(payout.amountFcfa, await autoReleaseLimit(mfiId))) {
    if (payout.firstApprovedById === staffId) throw new AppError("SECOND_OFFICER_NEEDED", 409);
    if (!payout.firstApprovedById) {
      const first = await prisma.payout.updateMany({
        where: { id: payoutId, status: "READY", firstApprovedById: null },
        data: { firstApprovedById: staffId, firstApprovedAt: new Date() },
      });
      if (first.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
      await prisma.auditEvent.create({
        data: { type: "STAFF_PAYOUT_APPROVED", details: { staffId, payoutId, round: payout.round.number } },
      });
      return listAttention(mfiId, staffId);
    }
  }

  await prisma.auditEvent.create({
    data: {
      type: "STAFF_PAYOUT_RELEASED",
      details: { staffId, payoutId, round: payout.round.number },
    },
  });
  await releasePayout(payoutId, staffId);
  return listAttention(mfiId, staffId);
}

// Payments the operator did not confirm, which the member says were debited:
// the officer checks them against the operator's statement. Oldest first.
// The member is named here: the officer must find her payment.
export async function listReported(mfiId: string): Promise<ConsoleReported[]> {
  const rows = await prisma.contribution.findMany({
    // D114: only once the automatic checks found nothing.
    where: { reportedAt: { not: null }, escalatedAt: { not: null }, status: { not: "PAID" }, round: { group: { mfiId } } },
    include: { round: { include: { group: true } }, user: { select: { displayName: true } } },
    orderBy: { reportedAt: "asc" },
  });
  return rows.map((c) => ({
    contributionId: c.id,
    groupId: c.round.groupId,
    groupName: c.round.group.name,
    roundNumber: c.round.number,
    memberName: c.user.displayName,
    phone: c.payerPhone,
    operator: c.operator,
    amountFcfa: c.amountFcfa,
    providerRef: c.providerRef,
    requestedAt: c.requestedAt?.toISOString() ?? null,
    reportedAt: (c.reportedAt as Date).toISOString(),
    autoChecks: c.autoChecks,
  }));
}

// The officer's answer. Found on the operator's statement: the payment is
// credited as if the operator had confirmed it. Not found: she is told to
// pay again, and her report is closed.
export async function resolveReported(
  mfiId: string,
  staffId: string,
  contributionId: string,
  arrived: boolean,
): Promise<ConsoleReported[]> {
  const row = await prisma.contribution.findFirst({
    where: { id: contributionId, round: { group: { mfiId } } },
  });
  if (!row) throw new AppError("NOT_FOUND", 404);
  if (!row.reportedAt || !row.escalatedAt || row.status === "PAID") throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.auditEvent.create({
    data: {
      type: arrived ? "STAFF_PAYMENT_FOUND" : "STAFF_PAYMENT_NOT_FOUND",
      details: { staffId, contributionId },
    },
  });
  if (arrived) await creditFoundPayment(contributionId, staffId);
  else await rejectReport(contributionId, staffId);
  return listReported(mfiId);
}

// D105: the admin sets the amount up to which pots leave without an officer.
export async function setAutoRelease(mfiId: string, staffId: string, amountFcfa: number | null): Promise<number | null> {
  await prisma.mfi.update({ where: { id: mfiId }, data: { autoReleaseFcfa: amountFcfa, autoReleaseChosenAt: new Date() } });
  await prisma.auditEvent.create({ data: { type: "STAFF_AUTO_RELEASE_SET", details: { staffId, amountFcfa } } });
  // Pots already waiting under the new limit leave on the job's next run.
  return amountFcfa;
}

// The officer asks for a failed transfer to be tried again now, instead of
// waiting for the next run of the payout job (D53). Only a FAILED payout of
// this MFI; the job's own claim makes a double send impossible (D49).
export async function retryPayout(
  mfiId: string,
  staffId: string,
  payoutId: string,
): Promise<AttentionItem[]> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, round: { group: { mfiId } } },
    include: { round: { select: { groupId: true, number: true } } },
  });
  if (!payout) throw new AppError("NOT_FOUND", 404);
  if (payout.status !== "FAILED") throw new AppError("NOT_ALLOWED_NOW", 409);

  await prisma.auditEvent.create({
    data: {
      type: "STAFF_PAYOUT_RETRY",
      details: { staffId, payoutId, round: payout.round.number },
    },
  });
  // D114: the officer's retry is one more try, now, even after the
  // automatic ones are used up.
  await prisma.payout.update({
    where: { id: payoutId },
    data: { failedAt: new Date(0), attempts: Math.min(payout.attempts, MAX_ATTEMPTS - 1) },
  });
  await runPayouts(new Date(), payout.round.groupId);
  return listAttention(mfiId);
}
