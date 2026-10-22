import type { RecordGroup, RecordShareView, RecordVerification, SavingsRecord } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { publicKeyPem, signRecord, verifyRecord } from "../lib/recordSigning.js";
import { isoDay } from "../lib/schedule.js";

// Her savings record, the ACEV (Sprint 6). It turns years of tontine saving,
// which banks cannot see today, into facts a lender can rely on: how often
// she paid, on time or late, how much she saved and received. Facts only,
// never a score (brief). It is hers: nobody sees it until she shares it
// (D33), and each share is signed, limited in time and logged (D50).

// A shared record stops working after this long; she can withdraw it sooner.
const SHARE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// Builds her record from the ledger and the rounds. Money totals come from
// the ledger, which nobody can change (D46); punctuality compares the day she
// paid with the round's due date.
export async function buildRecord(userId: string, now = new Date()): Promise<SavingsRecord> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { legalName: true, idVerifiedAt: true } });

  // Groups that started, where she held a seat to the start.
  const seats = await prisma.membership.findMany({
    where: { userId, payoutPosition: { not: null }, group: { state: { in: ["ACTIVE", "COMPLETED"] } } },
    include: {
      group: {
        include: {
          mfi: true,
          rulesVersions: true,
          rounds: { include: { contributions: { where: { userId, status: "PAID" } } } },
        },
      },
    },
  });

  const today = startOfDay(now);
  const groups: RecordGroup[] = seats.map(({ group }) => {
    const rules = group.rulesVersions.find((v) => v.version === group.currentVersion);
    let roundsDue = 0;
    let paid = 0;
    let onTime = 0;
    for (const round of group.rounds) {
      const payment = round.contributions.at(0);
      const due = startOfDay(round.dueDate);
      if (due < today) roundsDue += 1;
      if (payment?.paidAt) {
        paid += 1;
        if (startOfDay(payment.paidAt) <= due) onTime += 1;
      }
    }
    return {
      name: group.name,
      mfiName: group.mfi.name,
      amountFcfa: rules?.amountFcfa ?? 0,
      frequency: rules?.frequency ?? "WEEKLY",
      completed: group.state === "COMPLETED",
      roundsDue,
      paid,
      onTime,
    };
  });

  // A round counts as missed once its day has passed with no payment.
  const missed = seats.reduce(
    (sum, { group }) =>
      sum + group.rounds.filter((r) => startOfDay(r.dueDate) < today && r.contributions.length === 0).length,
    0,
  );

  const ledger = await prisma.ledgerEntry.groupBy({
    by: ["type"],
    where: { userId, type: { in: ["CONTRIBUTION", "PAYOUT"] } },
    _sum: { amountFcfa: true },
    _count: true,
  });
  const line = (type: "CONTRIBUTION" | "PAYOUT") => ledger.find((l) => l.type === type);

  const paymentsMade = groups.reduce((sum, g) => sum + g.paid, 0);
  const paidOnTime = groups.reduce((sum, g) => sum + g.onTime, 0);
  return {
    legalName: user.legalName,
    memberSince: isoDay(user.idVerifiedAt),
    asOf: isoDay(now),
    groupsJoined: groups.length,
    groupsCompleted: groups.filter((g) => g.completed).length,
    paymentsMade,
    paidOnTime,
    paidLate: paymentsMade - paidOnTime,
    missed,
    totalSavedFcfa: line("CONTRIBUTION")?._sum.amountFcfa ?? 0,
    potsReceived: line("PAYOUT")?._count ?? 0,
    totalReceivedFcfa: line("PAYOUT")?._sum.amountFcfa ?? 0,
    groups,
  };
}

// ---------- Sharing (D50) ----------

type ShareRow = { id: string; issuedAt: Date; expiresAt: Date; revokedAt: Date | null; views: { viewedAt: Date }[] };

function toShareView(share: ShareRow): RecordShareView {
  const last = share.views.at(0);
  return {
    id: share.id,
    issuedAt: share.issuedAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    views: share.views.length,
    lastViewedAt: last?.viewedAt.toISOString() ?? null,
  };
}

const withViews = { views: { orderBy: { viewedAt: "desc" as const }, select: { viewedAt: true } } };

// She shares her record: Novi freezes it as it is today and signs it.
export async function shareRecord(userId: string): Promise<RecordShareView> {
  const now = new Date();
  const payloadText = JSON.stringify(await buildRecord(userId, now));
  const share = await prisma.recordShare.create({
    data: {
      userId,
      payloadText,
      signature: signRecord(payloadText),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + SHARE_DAYS * DAY_MS),
    },
    include: withViews,
  });
  await prisma.auditEvent.create({ data: { userId, type: "RECORD_SHARED", details: { shareId: share.id } } });
  return toShareView(share);
}

export async function listShares(userId: string): Promise<RecordShareView[]> {
  const shares = await prisma.recordShare.findMany({ where: { userId }, orderBy: { issuedAt: "desc" }, include: withViews });
  return shares.map(toShareView);
}

// She withdraws a share: from now on it shows nothing.
export async function revokeShare(userId: string, shareId: string): Promise<RecordShareView> {
  const share = await prisma.recordShare.findUnique({ where: { id: shareId } });
  if (!share || share.userId !== userId) throw new AppError("NOT_FOUND", 404);
  await prisma.recordShare.updateMany({ where: { id: shareId, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.auditEvent.create({ data: { userId, type: "RECORD_SHARE_REVOKED", details: { shareId } } });
  return toShareView(await prisma.recordShare.findUniqueOrThrow({ where: { id: shareId }, include: withViews }));
}

// A lender opens a shared record. Every opening is logged, so she can see it
// was looked at (D37). The facts are shown only while the share is valid and
// its signature still matches.
export async function verifyShare(shareId: string, now = new Date()): Promise<RecordVerification> {
  const share = await prisma.recordShare.findUnique({ where: { id: shareId } });
  if (!share) throw new AppError("NOT_FOUND", 404);
  await prisma.recordView.create({ data: { shareId } });

  const base = { issuer: "Novi" as const, issuedAt: share.issuedAt.toISOString(), expiresAt: share.expiresAt.toISOString() };
  if (!verifyRecord(share.payloadText, share.signature)) return { ...base, status: "TAMPERED", record: null };
  if (share.revokedAt) return { ...base, status: "REVOKED", record: null };
  if (share.expiresAt <= now) return { ...base, status: "EXPIRED", record: null };
  return { ...base, status: "VALID", record: JSON.parse(share.payloadText) as SavingsRecord };
}

export { publicKeyPem };
