import type {
  BusinessKind,
  BusinessSince,
  ConsoleLoan,
  ConsoleLoanDetail,
  CreditPolicyInput,
  CreditPolicyPreview,
  CreditPolicyView,
  LoanBusiness,
  LoanCheck,
  LoanDocumentSpec,
  LoanPage,
  LoanPurpose,
  LoanRequestView,
} from "@novi/shared";
import type { CreditPolicy, LoanRequest, Mfi } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { hasSaved, savingsPolicy } from "./savingsService.js";
import { AppError } from "../lib/errors.js";
import { potShare } from "../lib/groupRules.js";
import { alertStaff } from "./alertService.js";
import { owedCovers } from "./memberService.js";
import { notifyMembers } from "./notifyService.js";

// Loan requests to the MFI (D89, D91). Novi carries the request, her record and
// her declared business; the MFI decides and lends at its agency. Novi keeps
// no document of hers.

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DOCUMENTS: LoanDocumentSpec[] = [
  { key: "ID_CARD", label: "Carte d'identité" },
  { key: "PHOTO", label: "Photo d'identité récente" },
  { key: "ADDRESS", label: "Justificatif de domicile (facture CEET ou TdE)" },
  { key: "ACTIVITY", label: "Preuve d'activité (reçu, facture ou ticket de marché)" },
];
const DEFAULT_POLICY = {
  enabled: true,
  minCycles: 1,
  minStreak: 8,
  minOnTimePct: 90,
  ceilingTimesPot: 3,
  waitDays: 30,
};

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
    largestPotFcfa: Math.max(0, ...groups.map((g) => g.potFcfa)),
    mfi: (groups.find((g) => g.state === "ACTIVE") ?? groups[0])?.mfi ?? null,
  };
}


type Policy = typeof DEFAULT_POLICY & { documents: LoanDocumentSpec[] };

function asDocuments(value: unknown): LoanDocumentSpec[] {
  return Array.isArray(value)
    ? value.filter(
        (d): d is LoanDocumentSpec =>
          typeof d === "object" &&
          d !== null &&
          typeof d.key === "string" &&
          typeof d.label === "string",
      )
    : [];
}

function toPolicy(row: CreditPolicy | null): Policy {
  if (!row) return { ...DEFAULT_POLICY, documents: DEFAULT_DOCUMENTS };
  return {
    enabled: row.enabled,
    minCycles: row.minCycles,
    minStreak: row.minStreak,
    minOnTimePct: row.minOnTimePct,
    ceilingTimesPot: row.ceilingTimesPot,
    waitDays: row.waitDays,
    documents: asDocuments(row.documents),
  };
}

export async function policyOf(mfiId: string): Promise<Policy> {
  return toPolicy(await prisma.creditPolicy.findUnique({ where: { mfiId } }));
}

export async function getCreditPolicy(
  mfiId: string,
): Promise<CreditPolicyView> {
  const row = await prisma.creditPolicy.findUnique({ where: { mfiId } });
  const by = row?.updatedById
    ? await prisma.staffUser.findUnique({
        where: { id: row.updatedById },
        select: { name: true },
      })
    : null;
  return {
    ...toPolicy(row),
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedByName: by?.name ?? null,
  };
}

export async function saveCreditPolicy(
  mfiId: string,
  staffId: string,
  input: CreditPolicyInput,
) {
  const data = { ...input, documents: input.documents, updatedById: staffId };
  await prisma.creditPolicy.upsert({
    where: { mfiId },
    create: { mfiId, ...data },
    update: data,
  });
  await prisma.auditEvent.create({
    data: {
      type: "STAFF_CREDIT_POLICY_CHANGED",
      details: { staffId, mfiId, policy: { ...input } },
    },
  });
  return getCreditPolicy(mfiId);
}

type Stats = Awaited<ReturnType<typeof memberStats>>;

// Her figures against the policy: the same checks for her and for the officer.
function checksFor(
  stats: Stats,
  policy: Policy,
  requests: { status: string; decidedAt: Date | null }[],
  now: Date,
): LoanCheck[] {
  const rate =
    stats.paymentsMade > 0
      ? Math.round((stats.paymentsOnTime / stats.paymentsMade) * 100)
      : 0;
  // The latest refusal, at the first look or at the agency.
  const refusedAt = Math.max(
    -1,
    ...requests
      .filter((r) => (r.status === "DECLINED" || r.status === "NOT_GRANTED") && r.decidedAt)
      .map((r) => (r.decidedAt as Date).getTime()),
  );
  const daysSince = refusedAt < 0 ? -1 : Math.floor((now.getTime() - refusedAt) / DAY_MS);
  const open = requests.some(
    (r) => r.status === "PENDING" || r.status === "PRESELECTED",
  );
  return [
    {
      key: "CYCLE_OR_STREAK",
      ok:
        stats.cyclesCompleted >= policy.minCycles ||
        stats.streak >= policy.minStreak,
      figures: {
        cycles: stats.cyclesCompleted,
        minCycles: policy.minCycles,
        streak: stats.streak,
        minStreak: policy.minStreak,
      },
    },
    {
      key: "ON_TIME",
      ok:
        stats.paymentsMade > 0 &&
        stats.paymentsOnTime * 100 >= policy.minOnTimePct * stats.paymentsMade,
      figures: {
        percent: rate,
        min: policy.minOnTimePct,
        onTime: stats.paymentsOnTime,
        made: stats.paymentsMade,
      },
    },
    {
      key: "NO_DEBT",
      ok: stats.owesFcfa === 0,
      figures: { owes: stats.owesFcfa },
    },
    { key: "NO_OPEN_REQUEST", ok: !open, figures: {} },
    {
      key: "WAIT_AFTER_REFUSAL",
      ok: daysSince < 0 || daysSince >= policy.waitDays,
      figures: { days: Math.max(daysSince, 0), wait: policy.waitDays },
    },
  ];
}

// How many more payments on time bring her to the MFI's minimum.
function onTimeNeeded(stats: Stats, minPct: number): number | null {
  const { paymentsOnTime: on, paymentsMade: made } = stats;
  if (made > 0 && on * 100 >= minPct * made) return 0;
  if (minPct >= 100) return null;
  // (on + n) / (made + n) >= min / 100
  return Math.max(1, Math.ceil((minPct * made - 100 * on) / (100 - minPct)));
}


function asBusiness(r: LoanRequest): LoanBusiness | null {
  if (!r.businessKind || !r.businessSince || r.weeklySalesFcfa === null || !r.businessPlace) return null;
  return { kind: r.businessKind, since: r.businessSince, weeklySalesFcfa: r.weeklySalesFcfa, place: r.businessPlace };
}

function toBring(r: LoanRequest): string[] {
  return r.status === "PRESELECTED" ? asDocuments(r.requiredDocs).map((d) => d.label) : [];
}

type FullLoan = LoanRequest & { mfi: Mfi };

function view(r: FullLoan): LoanRequestView {
  return {
    id: r.id,
    amountFcfa: r.amountFcfa,
    purpose: r.purpose,
    business: asBusiness(r),
    status: r.status,
    grantedFcfa: r.grantedFcfa,
    decisionNote: r.decisionNote,
    mfiName: r.mfi.name,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    toBring: toBring(r),
  };
}

export async function getLoanPage(userId: string, now = new Date()): Promise<LoanPage> {
  const [stats, requests, user] = await Promise.all([
    memberStats(userId),
    prisma.loanRequest.findMany({
      where: { userId },
      include: { mfi: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { area: true, market: true } }),
  ]);
  const policy = stats.mfi ? await policyOf(stats.mfi.id) : { ...DEFAULT_POLICY, documents: DEFAULT_DOCUMENTS };
  const checks = checksFor(stats, policy, requests, now);
  // D123: the MFI may ask that she has started saving with it first.
  if (stats.mfi && (await savingsPolicy(stats.mfi.id)).requireForLoan) {
    checks.push({ key: "SAVINGS", ok: await hasSaved(userId, stats.mfi.id), figures: {} });
  }
  const rate = stats.paymentsMade > 0 ? stats.paymentsOnTime / stats.paymentsMade : null;
  const last = requests.map(asBusiness).find((b) => b !== null) ?? null;
  return {
    enabled: policy.enabled,
    eligible: stats.mfi !== null && policy.enabled && checks.every((c) => c.ok),
    checks,
    ceilingFcfa: policy.ceilingTimesPot * stats.largestPotFcfa,
    documents: policy.documents,
    business: last,
    place: [user.market, user.area].filter(Boolean).join(", "),
    mfiName: stats.mfi?.name ?? null,
    onTimePercent: rate === null ? null : Math.round(rate * 100),
    onTimeNeeded: onTimeNeeded(stats, policy.minOnTimePct),
    requests: requests.map(view),
  };
}

export async function requestLoan(
  userId: string,
  input: { amountFcfa: number; purpose: LoanPurpose; business: LoanBusiness },
  now = new Date(),
): Promise<LoanPage> {
  const page = await getLoanPage(userId, now);
  if (!page.eligible) throw new AppError("LOAN_NOT_ELIGIBLE", 409);
  if (input.amountFcfa > page.ceilingFcfa) throw new AppError("LOAN_TOO_LARGE", 400);
  const { mfi } = await memberStats(userId);
  if (!mfi) throw new AppError("LOAN_NOT_ELIGIBLE", 409);
  const b = input.business;
  const created = await prisma.loanRequest.create({
    data: {
      userId,
      mfiId: mfi.id,
      amountFcfa: input.amountFcfa,
      purpose: input.purpose,
      businessKind: b.kind,
      businessSince: b.since,
      weeklySalesFcfa: b.weeklySalesFcfa,
      businessPlace: b.place.trim(),
    },
  });
  await prisma.auditEvent.create({
    data: { userId, type: "LOAN_REQUESTED", details: { loanId: created.id, mfiId: mfi.id, amountFcfa: input.amountFcfa } },
  });
  await alertStaff({
    mfiId: mfi.id,
    kind: "LOAN_REQUEST",
    refId: created.id,
    subject: `Demande de crédit : ${fcfa(input.amountFcfa)}`,
    lines: [
      `Une membre demande ${fcfa(input.amountFcfa)}.`,
      "Son historique Novi, son commerce et vos conditions sont dans la console.",
    ],
  });
  return getLoanPage(userId, now);
}

export async function withdrawLoan(userId: string, loanId: string): Promise<LoanPage> {
  const moved = await prisma.loanRequest.updateMany({
    where: { id: loanId, userId, status: { in: ["PENDING", "PRESELECTED"] } },
    data: { status: "WITHDRAWN", closedAt: new Date() },
  });
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  return getLoanPage(userId);
}

// ---------- The officer's side (console) ----------

async function toConsole(r: LoanRequest & { user: { legalName: string } }): Promise<ConsoleLoan> {
  const [stats, policy] = await Promise.all([memberStats(r.userId), policyOf(r.mfiId)]);
  return {
    id: r.id,
    memberName: r.user.legalName,
    groupNames: stats.groups.map((g) => g.name),
    amountFcfa: r.amountFcfa,
    purpose: r.purpose,
    business: asBusiness(r),
    status: r.status,
    grantedFcfa: r.grantedFcfa,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    ceilingFcfa: policy.ceilingTimesPot * stats.largestPotFcfa,
  };
}

export async function listLoans(mfiId: string): Promise<ConsoleLoan[]> {
  const loans = await prisma.loanRequest.findMany({
    where: { mfiId, status: { not: "WITHDRAWN" } },
    include: { user: { select: { legalName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return Promise.all(loans.map(toConsole));
}

export async function getLoan(mfiId: string, loanId: string): Promise<ConsoleLoanDetail> {
  const loan = await prisma.loanRequest.findFirst({
    where: { id: loanId, mfiId },
    include: {
      user: {
        select: { legalName: true, phone: true, area: true, market: true, idVerifiedAt: true, createdAt: true },
      },
    },
  });
  if (!loan) throw new AppError("NOT_FOUND", 404);
  const [stats, policyRow, others] = await Promise.all([
    memberStats(loan.userId),
    prisma.creditPolicy.findUnique({ where: { mfiId } }),
    prisma.loanRequest.findMany({ where: { userId: loan.userId, id: { not: loan.id } } }),
  ]);
  const policy = toPolicy(policyRow);
  const ceiling = policy.ceilingTimesPot * stats.largestPotFcfa;
  const checks = checksFor(stats, policy, others, loan.createdAt).filter((c) => c.key !== "NO_OPEN_REQUEST");
  checks.push({
    key: "CEILING",
    ok: loan.amountFcfa <= ceiling,
    figures: { amount: loan.amountFcfa, ceiling, times: policy.ceilingTimesPot },
  });
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
    checks,
    policyUpdatedAt: policyRow?.updatedAt.toISOString() ?? null,
    toBring: toBring(loan),
  };
}

const fcfa = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

export type LoanDecision =
  | { action: "preselect"; note?: string }
  | { action: "decline"; reason: string }
  | { action: "grant"; grantedFcfa: number; note?: string }
  | { action: "notGranted"; reason: string };

// First look: preselect (she comes to sign) or decline. At the agency, after
// she signed or not: granted, with the amount, or not granted.
export async function decideLoan(
  mfiId: string,
  staffId: string,
  loanId: string,
  decision: LoanDecision,
  now = new Date(),
): Promise<ConsoleLoanDetail> {
  const loan = await prisma.loanRequest.findFirst({ where: { id: loanId, mfiId }, include: { mfi: true } });
  if (!loan) throw new AppError("NOT_FOUND", 404);
  const mfiName = loan.mfi.name;
  const by = { decidedById: staffId, decidedAt: now };

  let moved: { count: number };
  let message: { fr: { title: string; body: string }; en: { title: string; body: string } };
  if (decision.action === "preselect") {
    const policy = await policyOf(mfiId);
    moved = await prisma.loanRequest.updateMany({
      where: { id: loan.id, status: "PENDING" },
      data: { status: "PRESELECTED", decisionNote: decision.note ?? null, requiredDocs: policy.documents, ...by },
    });
    message = {
      fr: { title: "Votre demande est retenue", body: `Passez signer à l'agence ${mfiName} avec vos pièces.` },
      en: { title: "Your request is shortlisted", body: `Come and sign at your ${mfiName} branch with your documents.` },
    };
  } else if (decision.action === "decline") {
    moved = await prisma.loanRequest.updateMany({
      where: { id: loan.id, status: "PENDING" },
      data: { status: "DECLINED", decisionNote: decision.reason, closedAt: now, ...by },
    });
    message = {
      fr: { title: "Demande de crédit refusée", body: decision.reason },
      en: { title: "Loan request declined", body: decision.reason },
    };
  } else {
    if (decision.action === "grant" && (decision.grantedFcfa <= 0 || decision.grantedFcfa > loan.amountFcfa)) {
      throw new AppError("VALIDATION_FAILED", 400);
    }
    const granted = decision.action === "grant";
    moved = await prisma.loanRequest.updateMany({
      where: { id: loan.id, status: "PRESELECTED" },
      data: granted
        ? { status: "GRANTED", grantedFcfa: decision.grantedFcfa, decisionNote: decision.note ?? null, closedAt: now, ...by }
        : { status: "NOT_GRANTED", decisionNote: decision.reason, closedAt: now, ...by },
    });
    message = granted
      ? {
          fr: { title: `Crédit accordé : ${fcfa(decision.grantedFcfa)}`, body: `Par ${mfiName}. Bon commerce !` },
          en: { title: `Loan granted: ${fcfa(decision.grantedFcfa)}`, body: `By ${mfiName}. Good trading!` },
        }
      : {
          fr: { title: "Crédit non accordé", body: decision.reason },
          en: { title: "Loan not granted", body: decision.reason },
        };
  }
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.auditEvent.create({
    data: { type: `STAFF_LOAN_${decision.action.toUpperCase()}`, details: { staffId, loanId } },
  });
  await notifyMembers([loan.userId], "money", "/loan", message.fr, message.en);
  return getLoan(mfiId, loanId);
}

// How many of the MFI's members would qualify with these conditions, before
// the administrator saves them.
export async function previewPolicy(
  mfiId: string,
  input: CreditPolicyInput,
  now = new Date(),
): Promise<CreditPolicyPreview> {
  const seats = await prisma.membership.findMany({
    where: { state: "ACCEPTED", exitReason: null, payoutPosition: { not: null }, group: { mfiId } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const policy: Policy = { ...input };
  let eligible = 0;
  for (const { userId } of seats) {
    const [stats, requests] = await Promise.all([
      memberStats(userId),
      prisma.loanRequest.findMany({ where: { userId }, select: { status: true, decidedAt: true } }),
    ]);
    if (input.enabled && checksFor(stats, policy, requests, now).every((c) => c.ok)) eligible += 1;
  }
  return { eligible, members: seats.length };
}

export const BUSINESS_KINDS: BusinessKind[] = ["FABRICS", "FOOD", "RESTAURANT", "BEAUTY", "OTHER"];
export const BUSINESS_SINCE: BusinessSince[] = ["UNDER_1Y", "Y1_TO_3", "OVER_3Y"];
