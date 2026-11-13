import { hasApp, notifyMembers } from "./notifyService.js";
import { createHash } from "node:crypto";
import type { ContributionView, LedgerLine, MobileOperator, RoundDetail, RoundSummary } from "@novi/shared";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { enforce } from "../lib/enforce.js";
import { AppError } from "../lib/errors.js";
import { nextCheckAt } from "../lib/autoChecks.js";
import { advanceOf, checkAction, checkCanPay, holdsSeat, PAYMENT_WAIT_MS, potShare } from "../lib/groupRules.js";
import { currentRoundNumber, isoDay } from "../lib/schedule.js";
import { receiptSms, failedSms, notFoundSms } from "../lib/smsText.js";
import { sms } from "../providers/index.js";
import { accountForMfi, accountForPayment, forgetBalance, type PaymentAccount } from "./paymentAccounts.js";
import { syncCoreBanking } from "./coreBanking.js";
import { runPayouts, pilotFastForward } from "./payoutService.js";
import { creditReserve } from "./reserveService.js";
import { canSkip } from "./advanceService.js";
import { postEvent } from "./chatService.js";
import { alertStaff } from "./alertService.js";
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
        include: {
          beneficiary: { select: { displayName: true } },
          contributions: true,
          payout: true,
          reserveCovers: true,
        },
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

function toSummary(loaded: Loaded, round: LoadedRound, userId: string, canSkipNow = false): RoundSummary {
  const paid = round.contributions.filter((c) => c.status === "PAID");
  const mine = round.contributions.find((c) => c.userId === userId);
  const cover = round.reserveCovers.find((c) => c.userId === userId);
  return {
    number: round.number,
    dueDate: isoDay(round.dueDate),
    beneficiaryName: round.beneficiary.displayName,
    isCurrent: round.number === loaded.current,
    amountFcfa: loaded.rules.amountFcfa,
    paidCount: paid.length,
    size: loaded.rules.size,
    collectedFcfa: paid.reduce((sum, c) => sum + c.amountFcfa - c.advanceFcfa, 0),
    potFcfa: potShare(loaded.rules.amountFcfa) * loaded.rules.size,
    myStatus: mine?.status ?? "UNPAID",
    myContributionId: mine?.id ?? null,
    myReported: Boolean(mine?.reportedAt),
    myReportRejected: Boolean(mine?.reportRejectedAt) && mine?.status !== "PAID",
    // D118: when Novi will ask the operator again, so the wait has an end.
    myNextCheckAt:
      mine && mine.status !== "PAID" && (mine.status === "PENDING" || mine.reportedAt)
        ? (nextCheckAt(mine)?.toISOString() ?? null)
        : null,
    payoutStatus: round.payout?.status ?? "NOT_DUE",
    paidOutAt: round.payout?.paidAt?.toISOString() ?? null,
    payoutId: round.payout?.id ?? null,
    receipt: round.payout?.receiptConfirmedAt ? "CONFIRMED" : round.payout?.receiptDisputedAt ? "DISPUTED" : null,
    coveredCount: round.reserveCovers.length,
    advanceFcfa: round.number === 1 ? advanceOf(loaded.rules.amountFcfa) : 0,
    myCover: cover
      ? {
          asked: cover.askedAt !== null,
          dueBy: cover.dueBy?.toISOString() ?? null,
          repaid: cover.repaidAt !== null,
          missed: cover.missedAt !== null,
        }
      : null,
    canSkip: canSkipNow,
  };
}

// The group's calendar: every round, who receives it, and how much is in.
export async function listRounds(groupId: string, userId: string): Promise<RoundSummary[]> {
  const loaded = await loadForMember(groupId, userId);
  const skip = loaded.group.state === "ACTIVE" && (await canSkip(groupId, userId, loaded.current));
  return loaded.group.rounds.map((round) => toSummary(loaded, round, userId, skip && round.number === loaded.current));
}

// One round with every member's payment. Every member sees every payment
// (F8); the MFI, by contrast, is told totals only (D33).
export async function getRound(groupId: string, userId: string, number: number): Promise<RoundDetail> {
  const loaded = await loadForMember(groupId, userId);
  const round = loaded.group.rounds.find((r) => r.number === number);
  if (!round) throw new AppError("NOT_FOUND", 404);
  const skip = loaded.group.state === "ACTIVE" && number === loaded.current && (await canSkip(groupId, userId, number));

  const payments = loaded.group.memberships.filter(holdsSeat).map((seat) => {
    const contribution = round.contributions.find((c) => c.userId === seat.userId);
    return {
      memberId: seat.userId,
      displayName: seat.user.displayName,
      status: contribution?.status ?? ("UNPAID" as const),
      paidAt: contribution?.paidAt?.toISOString() ?? null,
      coveredByReserve: round.reserveCovers.some((c) => c.userId === seat.userId),
      coverRepaid: round.reserveCovers.some((c) => c.userId === seat.userId && c.repaidAt !== null),
    };
  });
  const mfiName = (await prisma.mfi.findUnique({ where: { id: loaded.group.mfiId }, select: { name: true } }))?.name ?? "";
  return { ...toSummary(loaded, round, userId, skip), payments, mfiName };
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
    paymentUrl: null,
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
  const paidCurrent =
    group.rounds.find((r) => r.number === current)?.contributions.some((c) => c.userId === userId && c.status === "PAID") ??
    false;
  enforce(checkCanPay(number, current, existing, now, paidCurrent));

  // D102: the payment goes into the account of the MFI holding this group's
  // money; refused before anything is claimed if it has none yet.
  const account = await accountForMfi(group.mfiId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { phone: true, displayName: true },
  });
  // D103: round 1 also carries her advance, half a contribution, which stays
  // in the group's advances; the pot is still the contribution times members.
  const advanceFcfa = number === 1 ? advanceOf(rules.amountFcfa) : 0;
  const attempt = {
    amountFcfa: rules.amountFcfa + advanceFcfa,
    advanceFcfa,
    operator,
    payerPhone: user.phone,
    status: "PENDING" as const,
    provider: account.payments.name,
    paymentAccountMfiId: account.mfiId,
    providerRef: null,
    requestedAt: now,
    failedAt: null,
    // A new attempt closes any earlier report about this round (D105).
    reportedAt: null,
    reportRejectedAt: null,
    // D114: and starts its own automatic checks.
    autoChecks: 0,
    lastCheckedAt: null,
    escalatedAt: null,
  };

  // Claims the payment slot for this round. Two taps at the same moment
  // cannot both send a request: the unique (round, member) row, or the
  // condition on the update, lets only one through.
  // D105: while the MFI checks a payment she says left her account, she
  // must not pay a second time.
  if (existing?.reportedAt && existing.status !== "PAID") throw new AppError("PAYMENT_REPORTED", 409);

  let contributionId: string;
  try {
    if (existing) {
      const claimed = await prisma.contribution.updateMany({
        where: {
          id: existing.id,
          OR: [
            { status: "FAILED" },
            { status: "PENDING", requestedAt: { lt: new Date(now.getTime() - PAYMENT_WAIT_MS) } },
          ],
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

  let paymentUrl: string | null = null;
  try {
    const requested = await account.payments.requestCollection({
      reference: contributionId,
      amountFcfa: attempt.amountFcfa,
      phone: user.phone,
      operator,
      description: `Novi, ${group.name}, round ${number}`,
      payerName: user.displayName,
    });
    paymentUrl = requested.paymentUrl ?? null;
    await prisma.contribution.update({ where: { id: contributionId }, data: { providerRef: requested.providerRef } });
  } catch (err) {
    console.error(`Payment provider refused the request for contribution ${contributionId}:`, err);
    await prisma.contribution.update({
      where: { id: contributionId },
      data: { status: "FAILED", failedAt: new Date() },
    });
    throw new AppError("PAYMENT_UNAVAILABLE", 503);
  }

  await prisma.auditEvent.create({
    data: { userId, type: "CONTRIBUTION_REQUESTED", details: { groupId, round: number } },
  });
  const view = toView(
    await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId }, include: { round: true } }),
  );
  return { ...view, paymentUrl };
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
    const failed = await prisma.contribution.updateMany({
      where: { id: contributionId, status: "PENDING" },
      data: { status: "FAILED", failedAt: new Date() },
    });
    // Told once, when it turns from pending to failed: she checks her balance.
    if (failed.count > 0) {
      await sms.send(
        contribution.payerPhone,
        failedSms(contribution.user.language, {
          amountFcfa: contribution.amountFcfa,
          roundNumber: contribution.round.number,
          groupName: contribution.round.group.name,
          ref: receiptRef(contributionId),
        }),
      );
    }
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
    // D103: her advance (round 1), and the repayment of a cover for this round.
    await creditReserve(tx, contribution, contribution.round.groupId);
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
    // D127: in the pilot, the last payment of a round makes it due now.
    await pilotFastForward(contribution.roundId).catch((err: unknown) =>
      console.error("Pilot fast-forward failed:", err),
    );
    // The last payment of a round whose day has passed releases its held pot
    // at once, instead of waiting for the next run of the job (D48).
    await runPayouts(new Date(), contribution.round.groupId).catch((err: unknown) =>
      console.error("Payout after a payment failed:", err),
    );
    // D70: the group's chat shows that she paid.
    await postEvent(contribution.round.groupId, "PAID", contribution.userId, contribution.round.number);
    const group = contribution.round.group;
    // D111: a receipt by SMS only for a member without the app (who paid by
    // USSD); with the app, she sees it there, and her operator's own SMS
    // already tells her the money left.
    if (await hasApp(contribution.userId)) return;
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
// D102: each MFI's account has its own address (/payments/<MFI code>) and
// its own secret; the plain address is Novi's demo account.
export async function handlePaymentWebhook(
  rawBody: string,
  signature: string | undefined,
  mfiCode?: string,
): Promise<void> {
  const where = mfiCode ?? "demo";
  let account: PaymentAccount;
  if (mfiCode) {
    const owner = await prisma.mfi.findUnique({ where: { code: mfiCode }, select: { id: true, fedapaySecretKey: true } });
    if (!owner?.fedapaySecretKey) {
      trace(where, null, "refused: no MFI with this code, or no FedaPay account connected");
      throw new AppError("WEBHOOK_INVALID", 400);
    }
    account = await accountForMfi(owner.id);
  } else {
    account = await accountForPayment(null);
  }
  const payments = account.payments;
  let providerRef: string;
  try {
    ({ providerRef } = payments.verifyWebhook(rawBody, signature));
  } catch {
    trace(where, null, `refused: ${signature ? "signature does not match this webhook's secret" : "no signature"}`);
    throw new AppError("WEBHOOK_INVALID", 400);
  }

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  try {
    await prisma.paymentEvent.create({
      data: { provider: payments.name, bodyHash, providerRef, body: JSON.parse(rawBody) as Prisma.InputJsonValue },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      trace(where, providerRef, "already received, ignored");
      return;
    }
    throw err;
  }

  const contribution = await prisma.contribution.findUnique({ where: { providerRef } });
  // Not a Novi payment, or one made through another account: acknowledged, nothing to do.
  if (!contribution) return trace(where, providerRef, "ignored: no Novi payment has this transaction");
  if (contribution.paymentAccountMfiId !== account.mfiId) {
    return trace(where, providerRef, "ignored: this payment went through another account");
  }
  const answer = await payments.getStatus(providerRef);
  await settle(contribution.id, answer);
  const after = await prisma.contribution.findUnique({ where: { id: contribution.id }, select: { status: true } });
  trace(
    where,
    providerRef,
    `accepted: FedaPay says ${answer.status} ${answer.amountFcfa} FCFA; payment ${contribution.status} -> ${after?.status}, ` +
      `${Math.round((Date.now() - contribution.requestedAt.getTime()) / 1000)} s after it was asked`,
  );
  // D113: the dashboard shows the new balance and the booking at once.
  forgetBalance(account.mfiId);
  await syncCoreBanking().catch(() => undefined);
}

// She taps "check my payment": Novi asks the provider directly. Covers a
// webhook that never arrived, for example during a network cut.
// "The money left my account": a payment the operator did not confirm, which
// she says was debited. The provider is asked again first. D114: if it still
// is not paid, Novi keeps asking by itself (15 min, 1 h, 6 h, 24 h after her
// report); only if the 1 h check still finds nothing does it reach the MFI
// officer, to check against the operator's statement ("À traiter", D105).
// She does not pay again meanwhile.
export async function reportDebited(contributionId: string, userId: string): Promise<ContributionView> {
  const view = await checkContribution(contributionId, userId);
  if (view.status === "PAID") return view;
  if (view.status !== "FAILED" && view.status !== "PENDING") throw new AppError("NOT_FOUND", 404);
  // Once the MFI has said it did not find this attempt, only a new payment helps.
  const current = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } });
  if (current.reportRejectedAt) throw new AppError("NOT_ALLOWED_NOW", 409);
  const reported = await prisma.contribution.updateMany({
    where: { id: contributionId, reportedAt: null },
    data: { reportedAt: new Date(), autoChecks: 0, escalatedAt: null },
  });
  if (reported.count > 0) {
    await prisma.auditEvent.create({
      data: { userId, type: "PAYMENT_REPORTED", details: { contributionId, roundNumber: view.roundNumber } },
    });
  }
  return view;
}

// D150: one line in the server log for each notification from FedaPay and
// each payment Novi found by itself, so a slow payment can be explained.
// Never the body, the signature or a key.
function trace(where: string, providerRef: string | null, outcome: string): void {
  console.info(`[payment ${where}] transaction ${providerRef ?? "?"}: ${outcome}`);
}

// D114: Novi asks the provider again about a payment not confirmed (the job
// of automatic checks). True when this check found it paid.
export async function recheckPayment(contributionId: string): Promise<boolean> {
  const contribution = await prisma.contribution.findUnique({ where: { id: contributionId } });
  if (!contribution || contribution.status === "PAID" || !contribution.providerRef) return false;
  const { payments } = await accountForPayment(contribution.paymentAccountMfiId);
  await settle(contribution.id, await payments.getStatus(contribution.providerRef));
  const after = await prisma.contribution.findUniqueOrThrow({
    where: { id: contributionId },
    include: { round: { include: { group: { include: { mfi: true } } } } },
  });
  if (after.status !== "PAID") return false;
  // D150: a payment found by Novi's own check: its notification never came, or came refused.
  trace("check", contribution.providerRef, `credited by Novi's own check, ${Math.round((Date.now() - contribution.requestedAt.getTime()) / 1000)} s after it was asked`);
  forgetBalance(contribution.paymentAccountMfiId);
  await syncCoreBanking().catch(() => undefined);
  // She had said the money left: she is told it is now confirmed.
  if (contribution.reportedAt) {
    const { group } = after.round;
    await notifyMembers(
      [after.userId],
      "money",
      `/groups/${group.id}/rounds/${after.round.number}`,
      { title: group.name, body: `Votre paiement du tour ${after.round.number} est confirmé par l'opérateur.` },
      { title: group.name, body: `Your payment for round ${after.round.number} is now confirmed by the operator.` },
    ).catch(() => undefined);
  }
  return true;
}

// D114: the automatic checks did not find it: the officers check it against
// the operator's statement, and are told by email (D90).
export async function escalateReport(contributionId: string): Promise<boolean> {
  const moved = await prisma.contribution.updateMany({
    where: { id: contributionId, reportedAt: { not: null }, escalatedAt: null, status: { not: "PAID" } },
    data: { escalatedAt: new Date() },
  });
  if (moved.count === 0) return false;
  const current = await prisma.contribution.findUniqueOrThrow({
    where: { id: contributionId },
    include: { round: { include: { group: true } } },
  });
  const { round } = current;
  await alertStaff({
    mfiId: round.group.mfiId,
    kind: "PAYMENT_REPORTED",
    refId: contributionId, // the link opens the console's list, where it waits
    subject: `Paiement signalé : ${round.group.name}, tour ${round.number}`,
    lines: [
      `Une membre de « ${round.group.name} » dit que ${current.amountFcfa} FCFA ont quitté son compte pour le tour ${round.number}. L'opérateur ne l'a toujours pas confirmé après ${current.autoChecks} vérifications automatiques.`,
      "Vérifiez-le sur le relevé de l'opérateur, puis répondez dans la console.",
    ],
  });
  return true;
}

// D105: the officer found her payment on the operator's statement: it is
// credited exactly as if the operator had confirmed it (ledger, pot, chat).
export async function creditFoundPayment(contributionId: string, staffId: string): Promise<void> {
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } });
  await prisma.contribution.update({ where: { id: contributionId }, data: { reportCheckedById: staffId } });
  await settle(contributionId, { status: "PAID", amountFcfa: contribution.amountFcfa });
}

// D105: not found on the statement. Her report is closed and she is told to
// pay again: by notification, and by SMS if she has no app (D111).
export async function rejectReport(contributionId: string, staffId: string): Promise<void> {
  const contribution = await prisma.contribution.update({
    where: { id: contributionId },
    data: { reportedAt: null, escalatedAt: null, reportRejectedAt: new Date(), reportCheckedById: staffId },
    include: { round: { include: { group: { include: { mfi: true } } } }, user: { select: { language: true } } },
  });
  const { group } = contribution.round;
  const facts = {
    amountFcfa: contribution.amountFcfa,
    roundNumber: contribution.round.number,
    groupName: group.name,
    mfiName: group.mfi.name,
  };
  await notifyMembers(
    [contribution.userId],
    "money",
    `/groups/${group.id}/rounds/${contribution.round.number}`,
    { title: group.name, body: `${group.mfi.name} n'a pas trouvé votre paiement du tour ${facts.roundNumber}. Payez à nouveau.` },
    { title: group.name, body: `${group.mfi.name} did not find your payment for round ${facts.roundNumber}. Please pay again.` },
  ).catch(() => undefined);
  if (!(await hasApp(contribution.userId))) {
    await sms.send(contribution.payerPhone, notFoundSms(contribution.user.language, facts));
  }
}

export async function checkContribution(contributionId: string, userId: string): Promise<ContributionView> {
  const contribution = await prisma.contribution.findUnique({ where: { id: contributionId } });
  if (!contribution || contribution.userId !== userId) throw new AppError("NOT_FOUND", 404);
  if (contribution.status !== "PAID" && contribution.providerRef) {
    const { payments } = await accountForPayment(contribution.paymentAccountMfiId);
    await settle(contribution.id, await payments.getStatus(contribution.providerRef));
    // D113: the dashboard shows the new balance and the booking at once.
    forgetBalance(contribution.paymentAccountMfiId);
    await syncCoreBanking().catch(() => undefined);
  }
  return toView(
    await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId }, include: { round: true } }),
  );
}
