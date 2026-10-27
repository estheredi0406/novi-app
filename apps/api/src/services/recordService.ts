import { createHash } from "node:crypto";
import type { ConsoleSharedRecord, Lender, RecordGroup, RecordShareView, RecordVerification, SavingsRecord } from "@novi/shared";
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

  // D65: her ledger lines, in a fixed order, condensed into one fingerprint.
  // The ledger is never edited (D5); if a line were changed later, Novi
  // could no longer produce this fingerprint for this record.
  const lines = await prisma.ledgerEntry.findMany({
    where: { userId, createdAt: { lte: now } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, type: true, amountFcfa: true, createdAt: true },
  });
  const ledgerFingerprint = createHash("sha256")
    .update(lines.map((l) => `${l.id}|${l.type}|${l.amountFcfa}|${l.createdAt.toISOString()}`).join("\n"))
    .digest("hex");
  const potsConfirmed = await prisma.payout.count({ where: { beneficiaryId: userId, receiptConfirmedAt: { not: null } } });

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
    onTimeRate: paymentsMade > 0 ? Math.round((paidOnTime / paymentsMade) * 100) : 0,
    potsConfirmed,
    identityCheckedBy: "ANID",
    ledgerLines: lines.length,
    ledgerFingerprint,
  };
}

// ---------- Sharing (D50) ----------

type ShareRow = {
  id: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  mfi: { code: string; name: string } | null;
  views: { viewedAt: Date }[];
};

function toShareView(share: ShareRow): RecordShareView {
  const last = share.views.at(0);
  return {
    id: share.id,
    sharedWith: share.mfi && { code: share.mfi.code, name: share.mfi.name },
    issuedAt: share.issuedAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    revokedAt: share.revokedAt?.toISOString() ?? null,
    views: share.views.length,
    lastViewedAt: last?.viewedAt.toISOString() ?? null,
  };
}

const withViews = {
  views: { orderBy: { viewedAt: "desc" as const }, select: { viewedAt: true } },
  mfi: { select: { code: true, name: true } },
};

// The institutions she can share with by name: Novi's partner MFIs (D36).
export async function listLenders(): Promise<Lender[]> {
  return prisma.mfi.findMany({ select: { code: true, name: true }, orderBy: { name: "asc" } });
}

// She shares her record: Novi freezes it as it is today and signs it. With an
// MFI's code, only that MFI's staff can open it, in the console (D54);
// without, it is a code any lender she hands it to can open (D50).
export async function shareRecord(userId: string, mfiCode?: string): Promise<RecordShareView> {
  const mfi = mfiCode ? await prisma.mfi.findUnique({ where: { code: mfiCode } }) : null;
  if (mfiCode && !mfi) throw new AppError("NOT_FOUND", 404);
  const now = new Date();
  const payloadText = JSON.stringify(await buildRecord(userId, now));
  const share = await prisma.recordShare.create({
    data: {
      userId,
      payloadText,
      signature: signRecord(payloadText),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + SHARE_DAYS * DAY_MS),
      mfiId: mfi?.id ?? null,
    },
    include: withViews,
  });
  await prisma.auditEvent.create({
    data: { userId, type: "RECORD_SHARED", details: { shareId: share.id, mfi: mfi?.code ?? null } },
  });
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

// Who is opening a record shared with an MFI: one of its officers (D54).
type StaffViewer = { staffId: string; mfiId: string };

// A lender opens a shared record. Every opening is logged, so she can see it
// was looked at (D37). The facts are shown only while the share is valid and
// its signature still matches. A record shared with one MFI shows nothing to
// anyone else, not even with its code: only "shared with FUCEC-Togo" (D54).
export async function verifyShare(shareId: string, now = new Date(), viewer?: StaffViewer): Promise<RecordVerification> {
  const share = await prisma.recordShare.findUnique({ where: { id: shareId }, include: { mfi: true } });
  if (!share) throw new AppError("NOT_FOUND", 404);

  const base = {
    issuer: "Novi" as const,
    issuedAt: share.issuedAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    sharedWith: share.mfi?.name ?? null,
  };
  if (share.mfiId && share.mfiId !== viewer?.mfiId) return { ...base, status: "PRIVATE", record: null };
  await prisma.recordView.create({ data: { shareId, staffId: viewer?.staffId ?? null } });

  if (!verifyRecord(share.payloadText, share.signature)) return { ...base, status: "TAMPERED", record: null };
  if (share.revokedAt) return { ...base, status: "REVOKED", record: null };
  if (share.expiresAt <= now) return { ...base, status: "EXPIRED", record: null };
  return { ...base, status: "VALID", record: JSON.parse(share.payloadText) as SavingsRecord };
}

// ---------- In the MFI console (D54) ----------

// Records members shared with this MFI by name and have not withdrawn,
// newest first. Expired ones stay listed, so the officer sees why one stopped.
export async function listSharedWithMfi(mfiId: string): Promise<ConsoleSharedRecord[]> {
  const shares = await prisma.recordShare.findMany({
    where: { mfiId, revokedAt: null },
    orderBy: { issuedAt: "desc" },
    include: { _count: { select: { views: true } } },
  });
  return shares.map((share) => ({
    shareId: share.id,
    legalName: (JSON.parse(share.payloadText) as SavingsRecord).legalName,
    issuedAt: share.issuedAt.toISOString(),
    expiresAt: share.expiresAt.toISOString(),
    views: share._count.views,
  }));
}

// An officer opens one: the same check as the public page, but as this MFI.
// A share for another MFI answers 404, as if it did not exist.
export async function openSharedRecord(viewer: StaffViewer, shareId: string): Promise<RecordVerification> {
  const share = await prisma.recordShare.findUnique({ where: { id: shareId }, select: { mfiId: true } });
  if (!share || share.mfiId !== viewer.mfiId) throw new AppError("NOT_FOUND", 404);
  return verifyShare(shareId, new Date(), viewer);
}

export { publicKeyPem };
