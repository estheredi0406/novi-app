import type {
  ConsoleLoan,
  ConsoleLoanDetail,
  LoanCheck,
  LoanPage,
  LoanPurpose,
  LoanRequestView,
} from "@novi/shared";
import type { LoanRequest, Mfi } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { potShare } from "../lib/groupRules.js";
import { alertStaff } from "./alertService.js";
import { owedCovers } from "./memberService.js";
import { notifyMembers } from "./notifyService.js";

// D89: microloan requests to the MFI. Novi carries the request and her
// record; the MFI decides, lends and is repaid at its agency. Novi neither
// lends nor moves this money.
//
// She may ask when her record shows she pays: a finished tontine on Novi or
// 8 payments in a row on time, 90 % or more of her payments on time, nothing
// owed to the solidarity fund, no other request open, and 30 days since a
// refusal. The suggested ceiling is 3 times her largest pot; the officer may
// grant less, never more. Sending the request is her consent that the MFI
// sees her Novi record for it (D37).

const DAY_MS = 24 * 60 * 60 * 1000;
export const LOAN_RULES = {
  streak: 8,
  onTimeRate: 0.9,
  ceilingTimesPot: 3,
  waitAfterRefusalDays: 30,
} as const;

// Her record, from her payments: totals only.
export async function memberStats(userId: string) {
  const [payments, cyclesCompleted, owes, seats] = await Promise.all([
    prisma.contribution.findMany({
      where: { userId, status: "PAID" },
      select: { paidAt: true, round: { select: { dueDate: true } } },
      orderBy: { round: { dueDate: "asc" } },
    }),
    prisma.membership.count({
      where: {
        userId,
        state: "ACCEPTED",
        exitReason: null,
        group: { state: "COMPLETED" },
      },
    }),
    owedCovers(userId),
    prisma.membership.findMany({
      where: { userId, state: "ACCEPTED", payoutPosition: { not: null } },
      include: {
        group: {
          include: {
            mfi: true,
            rulesVersions: true,
            rounds: {
              include: { contributions: { where: { userId, status: "PAID" } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const onTimeFlags = payments.map(
    (c) =>
      c.paidAt !== null &&
      c.paidAt.getTime() < c.round.dueDate.getTime() + DAY_MS,
  );
  const onTime = onTimeFlags.filter(Boolean).length;
  // The run of on-time payments up to her latest one.
  let streak = 0;
  for (let i = onTimeFlags.length - 1; i >= 0 && onTimeFlags[i]; i -= 1)
    streak += 1;

  const groups = seats.map(({ group }) => {
    const rules = group.rulesVersions.find(
      (r) => r.version === group.currentVersion,
    );
    const amountFcfa = rules?.amountFcfa ?? 0;
    const size = rules?.size ?? 0;
    const paid = group.rounds.filter((r) => r.contributions.length > 0);
    return {
      name: group.name,
      state: group.state,
      mfi: group.mfi,
      amountFcfa,
      potFcfa: potShare(amountFcfa) * size,
      rounds: group.rounds.length,
      paid: paid.length,
      onTime: paid.filter((r) => {
        const at = r.contributions[0]?.paidAt;
        return (
          at !== null &&
          at !== undefined &&
          at.getTime() < r.dueDate.getTime() + DAY_MS
        );
      }).length,
    };
  });
  return {
    paymentsMade: payments.length,
    paymentsOnTime: onTime,
    streak,
    cyclesCompleted,
    owesFcfa: owes,
    groups,
    ceilingFcfa:
      LOAN_RULES.ceilingTimesPot * Math.max(0, ...groups.map((g) => g.potFcfa)),
    mfi: (groups.find((g) => g.state === "ACTIVE") ?? groups[0])?.mfi ?? null,
  };
}

function view(r: LoanRequest & { mfi: Mfi }): LoanRequestView {
  return {
    id: r.id,
    amountFcfa: r.amountFcfa,
    purpose: r.purpose,
    months: r.months,
    status: r.status,
    grantedFcfa: r.grantedFcfa,
    decisionNote: r.decisionNote,
    mfiName: r.mfi.name,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

export async function getLoanPage(
  userId: string,
  now = new Date(),
): Promise<LoanPage> {
  const [stats, requests] = await Promise.all([
    memberStats(userId),
    prisma.loanRequest.findMany({
      where: { userId },
      include: { mfi: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const lastRefusal = requests.find((r) => r.status === "DECLINED");
  const rate =
    stats.paymentsMade > 0 ? stats.paymentsOnTime / stats.paymentsMade : null;
  const checks: LoanCheck[] = [
    {
      key: "CYCLE_OR_STREAK",
      ok: stats.cyclesCompleted >= 1 || stats.streak >= LOAN_RULES.streak,
    },
    { key: "ON_TIME", ok: rate !== null && rate >= LOAN_RULES.onTimeRate },
    { key: "NO_DEBT", ok: stats.owesFcfa === 0 },
    {
      key: "NO_OPEN_REQUEST",
      ok: !requests.some((r) => r.status === "PENDING"),
    },
    {
      key: "WAIT_AFTER_REFUSAL",
      ok:
        !lastRefusal?.decidedAt ||
        now.getTime() - lastRefusal.decidedAt.getTime() >=
          LOAN_RULES.waitAfterRefusalDays * DAY_MS,
    },
  ];
  return {
    eligible: stats.mfi !== null && checks.every((c) => c.ok),
    checks,
    ceilingFcfa: stats.ceilingFcfa,
    mfiName: stats.mfi?.name ?? null,
    onTimePercent: rate === null ? null : Math.round(rate * 100),
    requests: requests.map(view),
  };
}

export async function requestLoan(
  userId: string,
  input: { amountFcfa: number; purpose: LoanPurpose; months: number },
  now = new Date(),
): Promise<LoanPage> {
  const page = await getLoanPage(userId, now);
  if (!page.eligible) throw new AppError("LOAN_NOT_ELIGIBLE", 409);
  if (input.amountFcfa > page.ceilingFcfa)
    throw new AppError("LOAN_TOO_LARGE", 400);
  const { mfi } = await memberStats(userId);
  if (!mfi) throw new AppError("LOAN_NOT_ELIGIBLE", 409);
  const created = await prisma.loanRequest.create({
    data: { userId, mfiId: mfi.id, ...input },
  });
  await prisma.auditEvent.create({
    data: {
      userId,
      type: "LOAN_REQUESTED",
      details: {
        loanId: created.id,
        mfiId: mfi.id,
        amountFcfa: input.amountFcfa,
      },
    },
  });
  // D90: the officers hear about it at once.
  await alertStaff({
    mfiId: mfi.id,
    kind: "LOAN_REQUEST",
    refId: created.id,
    subject: `Demande de crédit : ${fcfa(input.amountFcfa)}`,
    lines: [
      `Une membre demande ${fcfa(input.amountFcfa)} sur ${input.months} mois.`,
      "Son historique Novi est joint à la demande dans la console. Répondez dans les 4 heures ouvrées.",
    ],
  });
  return getLoanPage(userId, now);
}

export async function withdrawLoan(
  userId: string,
  loanId: string,
): Promise<LoanPage> {
  const moved = await prisma.loanRequest.updateMany({
    where: { id: loanId, userId, status: "PENDING" },
    data: { status: "WITHDRAWN" },
  });
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  return getLoanPage(userId);
}

// ---------- The officer's side (console) ----------

async function toConsole(
  r: LoanRequest & { user: { displayName: string; legalName: string } },
): Promise<ConsoleLoan> {
  const stats = await memberStats(r.userId);
  return {
    id: r.id,
    memberName: r.user.legalName,
    groupNames: stats.groups.map((g) => g.name),
    amountFcfa: r.amountFcfa,
    purpose: r.purpose,
    months: r.months,
    status: r.status,
    grantedFcfa: r.grantedFcfa,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    ceilingFcfa: stats.ceilingFcfa,
  };
}

const withUser = {
  user: { select: { displayName: true, legalName: true } },
} as const;

export async function listLoans(mfiId: string): Promise<ConsoleLoan[]> {
  const loans = await prisma.loanRequest.findMany({
    where: { mfiId, status: { not: "WITHDRAWN" } },
    include: withUser,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return Promise.all(loans.map(toConsole));
}

export async function getLoan(
  mfiId: string,
  loanId: string,
): Promise<ConsoleLoanDetail> {
  const loan = await prisma.loanRequest.findFirst({
    where: { id: loanId, mfiId },
    include: {
      user: {
        select: {
          displayName: true,
          legalName: true,
          phone: true,
          area: true,
          market: true,
          idVerifiedAt: true,
          createdAt: true,
        },
      },
    },
  });
  if (!loan) throw new AppError("NOT_FOUND", 404);
  const stats = await memberStats(loan.userId);
  return {
    ...(await toConsole(loan)),
    decisionNote: loan.decisionNote,
    phone: loan.user.phone,
    area: loan.user.area,
    market: loan.user.market,
    verifiedAt: loan.user.idVerifiedAt.toISOString(),
    memberSince: loan.user.createdAt.toISOString(),
    cyclesCompleted: stats.cyclesCompleted,
    paymentsMade: stats.paymentsMade,
    paymentsOnTime: stats.paymentsOnTime,
    owesFcfa: stats.owesFcfa,
    groups: stats.groups.map((g) => ({
      name: g.name,
      state: g.state,
      amountFcfa: g.amountFcfa,
      paid: g.paid,
      onTime: g.onTime,
      rounds: g.rounds,
    })),
  };
}

const fcfa = (n: number) =>
  `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

export async function decideLoan(
  mfiId: string,
  staffId: string,
  loanId: string,
  decision:
    | { approve: true; grantedFcfa: number; note?: string }
    | { approve: false; reason: string },
  now = new Date(),
): Promise<ConsoleLoanDetail> {
  const loan = await prisma.loanRequest.findFirst({
    where: { id: loanId, mfiId },
    include: { mfi: true },
  });
  if (!loan) throw new AppError("NOT_FOUND", 404);
  if (
    decision.approve &&
    (decision.grantedFcfa <= 0 || decision.grantedFcfa > loan.amountFcfa)
  ) {
    throw new AppError("VALIDATION_FAILED", 400);
  }
  const moved = await prisma.loanRequest.updateMany({
    where: { id: loan.id, status: "PENDING" },
    data: decision.approve
      ? {
          status: "APPROVED",
          grantedFcfa: decision.grantedFcfa,
          decisionNote: decision.note ?? null,
          decidedById: staffId,
          decidedAt: now,
        }
      : {
          status: "DECLINED",
          decisionNote: decision.reason,
          decidedById: staffId,
          decidedAt: now,
        },
  });
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.auditEvent.create({
    data: {
      type: decision.approve ? "STAFF_LOAN_APPROVED" : "STAFF_LOAN_DECLINED",
      details: { staffId, loanId },
    },
  });
  if (decision.approve) {
    await notifyMembers(
      [loan.userId],
      "money",
      "/loan",
      {
        title: `Crédit accordé : ${fcfa(decision.grantedFcfa)}`,
        body: `Venez à votre agence ${loan.mfi.name} avec votre carte d'identité.`,
      },
      {
        title: `Loan granted: ${fcfa(decision.grantedFcfa)}`,
        body: `Come to your ${loan.mfi.name} branch with your ID card.`,
      },
    );
  } else {
    await notifyMembers(
      [loan.userId],
      "money",
      "/loan",
      { title: "Demande de crédit refusée", body: decision.reason },
      { title: "Loan request declined", body: decision.reason },
    );
  }
  return getLoan(mfiId, loanId);
}
