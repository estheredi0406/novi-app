import { createHash } from "node:crypto";
import type { ContributionView, LedgerLine, MobileOperator, RoundDetail, RoundSummary } from "@novi/shared";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { enforce } from "../lib/enforce.js";
import { AppError } from "../lib/errors.js";
import { checkAction, checkCanPay, holdsSeat, PAYMENT_WAIT_MS } from "../lib/groupRules.js";
import { currentRoundNumber, isoDay } from "../lib/schedule.js";
import { receiptSms } from "../lib/smsText.js";
import { payments, sms } from "../providers/index.js";
import type { CollectionStatus } from "../providers/payment/PaymentProvider.js";

// Money in (Sprint 3). A payment goes through three stages:
// 1. She asks to pay; Novi asks the provider to send the request to her
//    phone, and the contribution is PENDING.
// 2. She confirms on her phone with her mobile money PIN (Novi never sees it).
// 3. The provider tells Novi by webhook; Novi asks the provider for the true
//    status and, if the money moved, marks the contribution PAID and adds one
//    line to the ledger. This step is safe to repeat: a payment is credited
//    once, however many times the webhook arrives (D45).

// ---------- Reading ----------

// A group with what the money screens need. Like every group read, anyone
// without a seat is told it does not exist (D32).
async function loadForMember(groupId: string, userId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      mfi: true,
      rulesVersions: true,
      memberships: { include: { user: { select: { displayName: true } } }, orderBy: { payoutPosition: "asc" } },
      rounds: {
        orderBy: { number: "asc" },
        include: { beneficiary: { select: { displayName: true } }, contributions: true },
      },
    },
  });
  const mySeat = group?.memberships.find((seat) => seat.userId === userId);
  if (!group || !mySeat || !holdsSeat(mySeat)) throw new AppError("NOT_FOUND", 404);

  const rules = group.rulesVersions.find((v) => v.version === group.currentVersion);
  if (!rules) throw new Error(`group ${group.id} has no rules version ${group.currentVersion}`);
  const current = currentRoundNumber(
    group.rounds.map((round) => round.dueDate),
    new Date(),
  );
  return { group, rules, current, isOrganiser: group.organiserId === userId };
}

type Loaded = Awaited<ReturnType<typeof loadForMember>>;
type LoadedRound = Loaded["group"]["rounds"][number];

function toSummary(loaded: Loaded, round: LoadedRound, userId: string): RoundSummary {
  const paid = round.contributions.filter((c) => c.status === "PAID");
  const mine = round.contributions.find((c) => c.userId === userId);
  return {
    number: round.number,
    dueDate: isoDay(round.dueDate),
    beneficiaryName: round.beneficiary.displayName,
    isCurrent: round.number === loaded.current,
    paidCount: paid.length,
    size: loaded.rules.size,
    collectedFcfa: paid.reduce((sum, c) => sum + c.amountFcfa, 0),
    potFcfa: loaded.rules.amountFcfa * loaded.rules.size,
    myStatus: mine?.status ?? "UNPAID",
  };
}

// The group's calendar: every round, who receives it, and how much is in.
export async function listRounds(groupId: string, userId: string): Promise<RoundSummary[]> {
  const loaded = await loadForMember(groupId, userId);
  return loaded.group.rounds.map((round) => toSummary(loaded, round, userId));
}

// One round with every member's payment. Every member sees every payment
// (F8); the MFI, by contrast, is told totals only (D33).
export async function getRound(groupId: string, userId: string, number: number): Promise<RoundDetail> {
  const loaded = await loadForMember(groupId, userId);
  const round = loaded.group.rounds.find((r) => r.number === number);
  if (!round) throw new AppError("NOT_FOUND", 404);

  const payments = loaded.group.memberships.filter(holdsSeat).map((seat) => {
    const contribution = round.contributions.find((c) => c.userId === seat.userId);
    return {
      memberId: seat.userId,
      displayName: seat.user.displayName,
      status: contribution?.status ?? ("UNPAID" as const),
      paidAt: contribution?.paidAt?.toISOString() ?? null,
    };
  });
  return { ...toSummary(loaded, round, userId), payments };
}

// The group's ledger, newest first. Lines are never edited (D5).
export async function listLedger(groupId: string, userId: string): Promise<LedgerLine[]> {
  await loadForMember(groupId, userId);
  const entries = await prisma.ledgerEntry.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    include: { round: { select: { number: true } }, user: { select: { displayName: true } } },
  });
  return entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    amountFcfa: entry.amountFcfa,
    roundNumber: entry.round?.number ?? null,
    memberName: entry.user?.displayName ?? null,
    createdAt: entry.createdAt.toISOString(),
  }));
}

// ---------- Paying ----------

// The short reference printed on her receipt: easy to read out over the phone.
const receiptRef = (contributionId: string) => contributionId.slice(0, 8).toUpperCase();

type ContributionRow = Prisma.ContributionGetPayload<{ include: { round: { select: { number: true } } } }>;

function toView(contribution: ContributionRow): ContributionView {
  return {
    id: contribution.id,
    roundNumber: contribution.round.number,
    amountFcfa: contribution.amountFcfa,
    operator: contribution.operator,
    status: contribution.status,
    requestedAt: contribution.requestedAt.toISOString(),
    paidAt: contribution.paidAt?.toISOString() ?? null,
    receiptRef: contribution.status === "PAID" ? receiptRef(contribution.id) : null,
  };
}

// She asks to pay her contribution for a round. Novi collects only from her
// own verified number, so nobody can make her group pay from another wallet.
export async function payRound(
  groupId: string,
  userId: string,
  number: number,
  operator: MobileOperator,
): Promise<ContributionView> {
  const { group, rules, current, isOrganiser } = await loadForMember(groupId, userId);
  enforce(checkAction("PAY", group.state, isOrganiser));
  const round = group.rounds.find((r) => r.number === number);
  if (!round) throw new AppError("NOT_FOUND", 404);
  const existing = round.contributions.find((c) => c.userId === userId) ?? null;
  const now = new Date();
  enforce(checkCanPay(number, current, existing, now));

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, displayName: true } });
  const attempt = {
    amountFcfa: rules.amountFcfa,
    operator,
    payerPhone: user.phone,
    status: "PENDING" as const,
    provider: payments.name,
    providerRef: null,
    requestedAt: now,
    failedAt: null,
  };

  // Claims the payment slot for this round. Two taps at the same moment
  // cannot both send a request: the unique (round, member) row, or the
  // condition on the update, lets only one through.
  let contributionId: string;
  try {
    if (existing) {
      const claimed = await prisma.contribution.updateMany({
        where: {
          id: existing.id,
          OR: [{ status: "FAILED" }, { status: "PENDING", requestedAt: { lt: new Date(now.getTime() - PAYMENT_WAIT_MS) } }],
        },
        data: attempt,
      });
      if (claimed.count === 0) throw new AppError("PAYMENT_IN_PROGRESS", 409);
      contributionId = existing.id;
    } else {
      contributionId = (await prisma.contribution.create({ data: { roundId: round.id, userId, ...attempt } })).id;
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("PAYMENT_IN_PROGRESS", 409);
    }
    throw err;
  }

  try {
    const { providerRef } = await payments.requestCollection({
      reference: contributionId,
      amountFcfa: rules.amountFcfa,
      phone: user.phone,
      operator,
      description: `Novi, ${group.name}, round ${number}`,
      payerName: user.displayName,
    });
    await prisma.contribution.update({ where: { id: contributionId }, data: { providerRef } });
  } catch (err) {
    console.error(`Payment provider refused the request for contribution ${contributionId}:`, err);
    await prisma.contribution.update({ where: { id: contributionId }, data: { status: "FAILED", failedAt: new Date() } });
    throw new AppError("PAYMENT_UNAVAILABLE", 503);
  }

  await prisma.auditEvent.create({ data: { userId, type: "CONTRIBUTION_REQUESTED", details: { groupId, round: number } } });
  return toView(await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId }, include: { round: true } }));
}

// ---------- Settling ----------

// Applies what the provider says about a payment. Safe to call any number of
// times with the same answer: the PAID update only matches a contribution
// that is not PAID yet, and the ledger accepts one line per contribution, so
// a payment is credited exactly once (D45).
async function settle(contributionId: string, answer: CollectionStatus): Promise<void> {
  const contribution = await prisma.contribution.findUniqueOrThrow({
    where: { id: contributionId },
    include: { round: { include: { group: { include: { mfi: true } } } }, user: { select: { language: true } } },
  });

  if (answer.status === "FAILED") {
    await prisma.contribution.updateMany({
      where: { id: contributionId, status: "PENDING" },
      data: { status: "FAILED", failedAt: new Date() },
    });
    return;
  }
  if (answer.status !== "PAID") return;

  // The provider must have collected exactly the contribution. Anything else
  // is not credited: it is recorded for the MFI officer to look into.
  if (answer.amountFcfa !== contribution.amountFcfa) {
    await prisma.auditEvent.create({
      data: {
        userId: contribution.userId,
        type: "PAYMENT_AMOUNT_MISMATCH",
        details: { contributionId, expected: contribution.amountFcfa, received: answer.amountFcfa },
      },
    });
    return;
  }

  const paidAt = new Date();
  const credited = await prisma.$transaction(async (tx) => {
    // A late approval after a FAILED still counts: the money did move.
    const moved = await tx.contribution.updateMany({
      where: { id: contributionId, status: { not: "PAID" } },
      data: { status: "PAID", paidAt },
    });
    if (moved.count === 0) return false;
    await tx.ledgerEntry.create({
      data: {
        groupId: contribution.round.groupId,
        roundId: contribution.roundId,
        userId: contribution.userId,
        type: "CONTRIBUTION",
        amountFcfa: contribution.amountFcfa,
        contributionId,
      },
    });
    await tx.auditEvent.create({
      data: {
        userId: contribution.userId,
        type: "CONTRIBUTION_PAID",
        details: { contributionId, round: contribution.round.number },
      },
    });
    return true;
  });

  if (credited) {
    const group = contribution.round.group;
    await sms.send(
      contribution.payerPhone,
      receiptSms(contribution.user.language, {
        amountFcfa: contribution.amountFcfa,
        roundNumber: contribution.round.number,
        groupName: group.name,
        date: isoDay(paidAt),
        ref: receiptRef(contributionId),
        mfiName: group.mfi.name,
      }),
    );
  }
}

// A webhook from the payment provider. Its signature is checked first; the
// same delivery received twice is recognised by its body and ignored. The
// webhook's own content is not trusted for the outcome: the provider is
// asked directly (FedaPay's own advice).
export async function handlePaymentWebhook(rawBody: string, signature: string | undefined): Promise<void> {
  let providerRef: string;
  try {
    ({ providerRef } = payments.verifyWebhook(rawBody, signature));
  } catch {
    throw new AppError("WEBHOOK_INVALID", 400);
  }

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  try {
    await prisma.paymentEvent.create({
      data: { provider: payments.name, bodyHash, providerRef, body: JSON.parse(rawBody) as Prisma.InputJsonValue },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // already handled
    throw err;
  }

  const contribution = await prisma.contribution.findUnique({ where: { providerRef } });
  if (!contribution) return; // not a Novi payment, or not ours: acknowledged, nothing to do
  await settle(contribution.id, await payments.getStatus(providerRef));
}

// She taps "check my payment": Novi asks the provider directly. Covers a
// webhook that never arrived, for example during a network cut.
export async function checkContribution(contributionId: string, userId: string): Promise<ContributionView> {
  const contribution = await prisma.contribution.findUnique({ where: { id: contributionId } });
  if (!contribution || contribution.userId !== userId) throw new AppError("NOT_FOUND", 404);
  if (contribution.status !== "PAID" && contribution.providerRef) {
    await settle(contribution.id, await payments.getStatus(contribution.providerRef));
  }
  return toView(await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId }, include: { round: true } }));
}
