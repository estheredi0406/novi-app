import type {
  ConsoleLoan,
  ConsoleLoanDetail,
  CreditPolicyInput,
  CreditPolicyPreview,
  CreditPolicyView,
  LoanCheck,
  LoanDocumentSpec,
  LoanDocumentView,
  LoanPage,
  LoanPurpose,
  LoanRequestView,
} from "@novi/shared";
import type {
  CreditPolicy,
  LoanDocument,
  LoanRequest,
  Mfi,
} from "../generated/prisma/client.js";
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
// D91: the conditions are the MFI's own (CreditPolicy, set by its
// administrator in the console); without a policy, Novi's defaults: a
// finished tontine or 8 payments in a row on time, 90 % or more on time,
// nothing owed to the fund, no other request open, 30 days since a refusal,
// a ceiling of 3 times her largest pot. Sending the request is her consent
// that the MFI sees her Novi record for it (D37).
//
// D91: the officer's first answer is not a loan. "Preselected" means her
// record convinces the MFI, which asks for her documents; she sends photos;
// the officer checks each one; once all are accepted she goes to the agency
// with the originals, and the MFI decides there. The officer then records
// the outcome (granted, with the amount, or not). Photos are deleted 30 days
// after the file is complete or closed.

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DOCUMENTS: LoanDocumentSpec[] = [
  { key: "ID_CARD", label: "Carte d'identité, recto et verso" },
  { key: "PHOTO", label: "Photo d'identité récente" },
  { key: "ADDRESS", label: "Justificatif de domicile (facture CEET ou TdE)" },
  {
    key: "ACTIVITY",
    label:
      "Preuve d'activité (carte de commerçante, ticket de marché ou facture d'un fournisseur)",
  },
];
const DEFAULT_POLICY = {
  enabled: true,
  minCycles: 1,
  minStreak: 8,
  minOnTimePct: 90,
  ceilingTimesPot: 3,
  waitDays: 30,
  months: [3, 6, 12],
};
const DOCUMENT_MAX_BYTES = 2_500_000;
const DOCUMENT_MIMES = ["image/jpeg", "image/png", "image/webp"];
const KEEP_PHOTOS_DAYS = 30;

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

// ---------- D91: the MFI's credit policy ----------

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
    months: row.months.length > 0 ? row.months : DEFAULT_POLICY.months,
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
  const refusal = requests.find((r) => r.status === "DECLINED" && r.decidedAt);
  const daysSince = refusal?.decidedAt
    ? Math.floor((now.getTime() - refusal.decidedAt.getTime()) / DAY_MS)
    : -1;
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

// What the member sees on the documents, and the officer too.
function documentsView(
  loan: LoanRequest & { documents: Omit<LoanDocument, "data">[] },
): LoanDocumentView[] {
  return asDocuments(loan.requiredDocs).map((spec) => {
    const doc = loan.documents.find((d) => d.key === spec.key);
    return {
      key: spec.key,
      label: spec.label,
      status: doc ? doc.status : "MISSING",
      note: doc?.note ?? null,
      id: doc && !doc.deletedAt && doc.status !== "PAPER" ? doc.id : null,
      sentAt: doc?.createdAt.toISOString() ?? null,
      deleted: Boolean(doc?.deletedAt),
    };
  });
}

type FullLoan = LoanRequest & {
  mfi: Mfi;
  documents: Omit<LoanDocument, "data">[];
};

function view(r: FullLoan): LoanRequestView {
  const documents = documentsView(r);
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
    documents,
    documentsConsented: r.documentsConsentAt !== null,
    documentsComplete: r.documentsCheckedAt !== null,
  };
}

async function loadLoans(userId: string): Promise<FullLoan[]> {
  const loans = await prisma.loanRequest.findMany({
    where: { userId },
    include: { mfi: true, documents: { omit: { data: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return loans;
}

export async function getLoanPage(
  userId: string,
  now = new Date(),
): Promise<LoanPage> {
  const [stats, requests] = await Promise.all([
    memberStats(userId),
    loadLoans(userId),
  ]);
  const policy = stats.mfi
    ? await policyOf(stats.mfi.id)
    : { ...DEFAULT_POLICY, documents: DEFAULT_DOCUMENTS };
  const checks = checksFor(stats, policy, requests, now);
  const rate =
    stats.paymentsMade > 0 ? stats.paymentsOnTime / stats.paymentsMade : null;
  return {
    enabled: policy.enabled,
    eligible: stats.mfi !== null && policy.enabled && checks.every((c) => c.ok),
    checks,
    ceilingFcfa: policy.ceilingTimesPot * stats.largestPotFcfa,
    months: policy.months,
    documents: policy.documents,
    mfiName: stats.mfi?.name ?? null,
    onTimePercent: rate === null ? null : Math.round(rate * 100),
    onTimeNeeded: onTimeNeeded(stats, policy.minOnTimePct),
    requests: requests.map(view),
  };
}

export async function requestLoan(
  userId: string,
  input: { amountFcfa: number; purpose: LoanPurpose; months?: number },
  now = new Date(),
): Promise<LoanPage> {
  const page = await getLoanPage(userId, now);
  if (!page.eligible) throw new AppError("LOAN_NOT_ELIGIBLE", 409);
  if (input.amountFcfa > page.ceilingFcfa)
    throw new AppError("LOAN_TOO_LARGE", 400);
  if (input.months !== undefined && !page.months.includes(input.months))
    throw new AppError("VALIDATION_FAILED", 400);
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
      input.months
        ? `Une membre demande ${fcfa(input.amountFcfa)} sur ${input.months} mois.`
        : `Une membre demande ${fcfa(input.amountFcfa)}. La durée se décide avec elle à l'agence.`,
      "Son historique Novi et vos conditions, vérifiées une à une, sont dans la console.",
    ],
  });
  return getLoanPage(userId, now);
}

export async function withdrawLoan(
  userId: string,
  loanId: string,
): Promise<LoanPage> {
  const moved = await prisma.loanRequest.updateMany({
    where: { id: loanId, userId, status: { in: ["PENDING", "PRESELECTED"] } },
    data: { status: "WITHDRAWN", closedAt: new Date() },
  });
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  return getLoanPage(userId);
}

// ---------- D91: her documents ----------

async function myPreselected(userId: string, loanId: string) {
  const loan = await prisma.loanRequest.findFirst({
    where: { id: loanId, userId },
  });
  if (!loan) throw new AppError("NOT_FOUND", 404);
  if (loan.status !== "PRESELECTED") throw new AppError("NOT_ALLOWED_NOW", 409);
  return loan;
}

export async function consentToDocuments(
  userId: string,
  loanId: string,
): Promise<LoanPage> {
  const loan = await myPreselected(userId, loanId);
  if (!loan.documentsConsentAt) {
    await prisma.loanRequest.update({
      where: { id: loan.id },
      data: { documentsConsentAt: new Date() },
    });
    await prisma.auditEvent.create({
      data: { userId, type: "LOAN_DOCUMENTS_CONSENT", details: { loanId } },
    });
  }
  return getLoanPage(userId);
}

export async function sendDocument(
  userId: string,
  loanId: string,
  key: string,
  file: { mime: string; base64: string },
): Promise<LoanPage> {
  const loan = await myPreselected(userId, loanId);
  if (!loan.documentsConsentAt)
    throw new AppError("DOCUMENTS_CONSENT_REQUIRED", 409);
  if (!asDocuments(loan.requiredDocs).some((d) => d.key === key))
    throw new AppError("NOT_FOUND", 404);
  const data = Buffer.from(file.base64, "base64");
  if (
    !DOCUMENT_MIMES.includes(file.mime) ||
    data.length === 0 ||
    data.length > DOCUMENT_MAX_BYTES
  ) {
    throw new AppError("DOCUMENT_INVALID", 400);
  }
  const existing = await prisma.loanDocument.findUnique({
    where: { loanId_key: { loanId, key } },
    select: { status: true },
  });
  if (existing?.status === "ACCEPTED")
    throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.loanDocument.upsert({
    where: { loanId_key: { loanId, key } },
    create: { loanId, key, mime: file.mime, data },
    update: {
      mime: file.mime,
      data,
      status: "SENT",
      note: null,
      reviewedAt: null,
      reviewedById: null,
      deletedAt: null,
    },
  });
  await prisma.auditEvent.create({
    data: { userId, type: "LOAN_DOCUMENT_SENT", details: { loanId, key } },
  });
  const required = asDocuments(loan.requiredDocs).length;
  const sent = await prisma.loanDocument.count({
    where: { loanId, status: { in: ["SENT", "ACCEPTED", "PAPER"] } },
  });
  if (sent === required) {
    await alertStaff({
      mfiId: loan.mfiId,
      kind: "LOAN_REQUEST",
      refId: `${loan.id}:documents`,
      subject: "Pièces reçues pour une demande de crédit",
      lines: [
        "Une membre présélectionnée a envoyé toutes ses pièces.",
        "Vérifiez-les dans la console.",
      ],
    });
  }
  return getLoanPage(userId);
}

// Deletes the photos 30 days after a file is complete or closed, and those
// of a file left unfinished for 60 days. Runs with the alert job.
export async function purgeLoanDocuments(now = new Date()): Promise<number> {
  const keep = new Date(now.getTime() - KEEP_PHOTOS_DAYS * DAY_MS);
  const stale = new Date(now.getTime() - 2 * KEEP_PHOTOS_DAYS * DAY_MS);
  const purged = await prisma.loanDocument.updateMany({
    where: {
      data: { not: null },
      OR: [
        { loan: { documentsCheckedAt: { lt: keep } } },
        { loan: { closedAt: { lt: keep } } },
        { loan: { decidedAt: { lt: stale } } },
      ],
    },
    data: { data: null, deletedAt: now },
  });
  return purged.count;
}

// ---------- The officer's side (console) ----------

async function toConsole(
  r: LoanRequest & {
    user: { displayName: string; legalName: string };
    documents: { status: string }[];
  },
): Promise<ConsoleLoan> {
  const [stats, policy] = await Promise.all([
    memberStats(r.userId),
    policyOf(r.mfiId),
  ]);
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
    ceilingFcfa: policy.ceilingTimesPot * stats.largestPotFcfa,
    documentsSent: r.documents.filter((d) => d.status === "SENT").length,
    documentsComplete: r.documentsCheckedAt !== null,
  };
}

const forList = {
  user: { select: { displayName: true, legalName: true } },
  documents: { select: { status: true } },
} as const;

export async function listLoans(mfiId: string): Promise<ConsoleLoan[]> {
  const loans = await prisma.loanRequest.findMany({
    where: { mfiId, status: { not: "WITHDRAWN" } },
    include: forList,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return Promise.all(loans.map(toConsole));
}

export async function getLoan(
  mfiId: string,
  loanId: string,
  now = new Date(),
): Promise<ConsoleLoanDetail> {
  const loan = await prisma.loanRequest.findFirst({
    where: { id: loanId, mfiId },
    include: {
      mfi: true,
      documents: { omit: { data: true } },
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
  const [stats, policyRow, others] = await Promise.all([
    memberStats(loan.userId),
    prisma.creditPolicy.findUnique({ where: { mfiId } }),
    prisma.loanRequest.findMany({
      where: { userId: loan.userId, id: { not: loan.id } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const policy = toPolicy(policyRow);
  const ceiling = policy.ceilingTimesPot * stats.largestPotFcfa;
  const checks = checksFor(stats, policy, others, loan.createdAt).filter(
    (c) => c.key !== "NO_OPEN_REQUEST",
  );
  checks.push({
    key: "CEILING",
    ok: loan.amountFcfa <= ceiling,
    figures: {
      amount: loan.amountFcfa,
      ceiling,
      times: policy.ceilingTimesPot,
    },
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
    documents: documentsView(loan),
    documentsConsented: loan.documentsConsentAt !== null,
  };
}

const fcfa = (n: number) =>
  `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;

export type LoanDecision =
  | { action: "preselect"; note?: string }
  | { action: "decline"; reason: string }
  | { action: "grant"; grantedFcfa: number; note?: string }
  | { action: "notGranted"; reason: string };

// The officer's steps: preselect (ask for documents) or decline; then, after
// the meeting at the agency, the outcome: granted (with the amount) or not.
export async function decideLoan(
  mfiId: string,
  staffId: string,
  loanId: string,
  decision: LoanDecision,
  now = new Date(),
): Promise<ConsoleLoanDetail> {
  const loan = await prisma.loanRequest.findFirst({
    where: { id: loanId, mfiId },
    include: { mfi: true },
  });
  if (!loan) throw new AppError("NOT_FOUND", 404);
  const mfiName = loan.mfi.name;
  const by = { decidedById: staffId, decidedAt: now };

  let moved: { count: number };
  let message: {
    fr: { title: string; body: string };
    en: { title: string; body: string };
  };
  if (decision.action === "preselect") {
    const policy = await policyOf(mfiId);
    moved = await prisma.loanRequest.updateMany({
      where: { id: loan.id, status: "PENDING" },
      data: {
        status: "PRESELECTED",
        decisionNote: decision.note ?? null,
        requiredDocs: policy.documents,
        ...by,
      },
    });
    message = {
      fr: {
        title: "Votre demande est retenue",
        body: `${mfiName} vous invite à envoyer vos pièces dans Novi.`,
      },
      en: {
        title: "Your request is shortlisted",
        body: `${mfiName} asks you to send your documents in Novi.`,
      },
    };
  } else if (decision.action === "decline") {
    moved = await prisma.loanRequest.updateMany({
      where: { id: loan.id, status: "PENDING" },
      data: {
        status: "DECLINED",
        decisionNote: decision.reason,
        closedAt: now,
        ...by,
      },
    });
    message = {
      fr: { title: "Demande de crédit refusée", body: decision.reason },
      en: { title: "Loan request declined", body: decision.reason },
    };
  } else {
    if (
      decision.action === "grant" &&
      (decision.grantedFcfa <= 0 || decision.grantedFcfa > loan.amountFcfa)
    ) {
      throw new AppError("VALIDATION_FAILED", 400);
    }
    const granted = decision.action === "grant";
    moved = await prisma.loanRequest.updateMany({
      where: { id: loan.id, status: "PRESELECTED" },
      data: granted
        ? {
            status: "GRANTED",
            grantedFcfa: decision.grantedFcfa,
            decisionNote: decision.note ?? null,
            closedAt: now,
            ...by,
          }
        : {
            status: "NOT_GRANTED",
            decisionNote: decision.reason,
            closedAt: now,
            ...by,
          },
    });
    message = granted
      ? {
          fr: {
            title: `Crédit accordé : ${fcfa(decision.grantedFcfa)}`,
            body: `Par ${mfiName}. Bon commerce !`,
          },
          en: {
            title: `Loan granted: ${fcfa(decision.grantedFcfa)}`,
            body: `By ${mfiName}. Good trading!`,
          },
        }
      : {
          fr: { title: "Crédit non accordé", body: decision.reason },
          en: { title: "Loan not granted", body: decision.reason },
        };
  }
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.auditEvent.create({
    data: {
      type: `STAFF_LOAN_${decision.action.toUpperCase()}`,
      details: { staffId, loanId },
    },
  });
  await notifyMembers([loan.userId], "money", "/loan", message.fr, message.en);
  return getLoan(mfiId, loanId);
}

// The officer opens one photo. Every view is logged with his id.
export async function openDocument(
  mfiId: string,
  staffId: string,
  loanId: string,
  documentId: string,
) {
  const doc = await prisma.loanDocument.findFirst({
    where: { id: documentId, loanId, loan: { mfiId } },
  });
  if (!doc || !doc.data) throw new AppError("NOT_FOUND", 404);
  await prisma.auditEvent.create({
    data: {
      type: "STAFF_LOAN_DOCUMENT_VIEWED",
      details: { staffId, loanId, key: doc.key },
    },
  });
  return { mime: doc.mime, data: Buffer.from(doc.data) };
}

// The officer accepts a photo or asks for a new one. When every document is
// accepted, the file is complete: she is told to go to the agency.
export async function reviewDocument(
  mfiId: string,
  staffId: string,
  loanId: string,
  documentId: string,
  review: { accepted: boolean; note?: string },
  now = new Date(),
): Promise<ConsoleLoanDetail> {
  const doc = await prisma.loanDocument.findFirst({
    where: { id: documentId, loanId, loan: { mfiId, status: "PRESELECTED" } },
    include: { loan: { include: { mfi: true } } },
  });
  if (!doc || !doc.data) throw new AppError("NOT_FOUND", 404);
  await prisma.loanDocument.update({
    where: { id: doc.id },
    data: {
      status: review.accepted ? "ACCEPTED" : "REDO",
      note: review.note ?? null,
      reviewedById: staffId,
      reviewedAt: now,
    },
  });
  const mfiName = doc.loan.mfi.name;
  const label =
    asDocuments(doc.loan.requiredDocs).find((d) => d.key === doc.key)?.label ??
    doc.key;
  if (!review.accepted) {
    await notifyMembers(
      [doc.loan.userId],
      "money",
      "/loan",
      {
        title: "Une pièce est à refaire",
        body: `${label}${review.note ? ` : ${review.note}` : ""}`,
      },
      {
        title: "A document needs a new photo",
        body: `${label}${review.note ? `: ${review.note}` : ""}`,
      },
    );
  } else {
    await completeIfReady(loanId, now);
  }
  await prisma.auditEvent.create({
    data: {
      type: "STAFF_LOAN_DOCUMENT_REVIEWED",
      details: { staffId, loanId, key: doc.key, accepted: review.accepted },
    },
  });
  return getLoan(mfiId, loanId);
}

// D91, D118: every document accepted, or coming on paper: she goes to the
// agency with the originals, where the MFI decides.
async function completeIfReady(loanId: string, now: Date) {
  const loan = await prisma.loanRequest.findUnique({ where: { id: loanId }, include: { mfi: true } });
  if (!loan || loan.documentsCheckedAt) return;
  const required = asDocuments(loan.requiredDocs).length;
  const ready = await prisma.loanDocument.count({
    where: { loanId, status: { in: ["ACCEPTED", "PAPER"] } },
  });
  if (ready !== required) return;
  await prisma.loanRequest.update({ where: { id: loanId }, data: { documentsCheckedAt: now } });
  const mfiName = loan.mfi.name;
  await notifyMembers(
    [loan.userId],
    "money",
    "/loan",
    {
      title: "Dossier complet",
      body: `Venez à votre agence ${mfiName} avec les originaux : ${mfiName} décide sur place.`,
    },
    {
      title: "Your file is complete",
      body: `Come to your ${mfiName} branch with the originals: ${mfiName} decides there.`,
    },
  );
}

// D118: a document she cannot photograph now (the CEET bill is at her
// landlord's): she brings it on paper to the agency, and the file goes on.
export async function bringOnPaper(userId: string, loanId: string, key: string, now = new Date()): Promise<LoanPage> {
  const loan = await myPreselected(userId, loanId);
  if (!asDocuments(loan.requiredDocs).some((d) => d.key === key)) throw new AppError("NOT_FOUND", 404);
  const existing = await prisma.loanDocument.findUnique({ where: { loanId_key: { loanId, key } }, select: { status: true } });
  if (existing?.status === "ACCEPTED") throw new AppError("NOT_ALLOWED_NOW", 409);
  await prisma.loanDocument.upsert({
    where: { loanId_key: { loanId, key } },
    create: { loanId, key, mime: "", data: null, status: "PAPER" },
    update: { mime: "", data: null, status: "PAPER", note: null, reviewedAt: null, reviewedById: null },
  });
  await prisma.auditEvent.create({ data: { userId, type: "LOAN_DOCUMENT_ON_PAPER", details: { loanId, key } } });
  await completeIfReady(loanId, now);
  return getLoanPage(userId, now);
}

// D91: how many of the MFI's members would qualify with these conditions,
// before the administrator saves them.
export async function previewPolicy(
  mfiId: string,
  input: CreditPolicyInput,
  now = new Date(),
): Promise<CreditPolicyPreview> {
  const seats = await prisma.membership.findMany({
    where: {
      state: "ACCEPTED",
      exitReason: null,
      payoutPosition: { not: null },
      group: { mfiId },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  const policy: Policy = { ...input };
  let eligible = 0;
  for (const { userId } of seats) {
    const [stats, requests] = await Promise.all([
      memberStats(userId),
      prisma.loanRequest.findMany({
        where: { userId },
        select: { status: true, decidedAt: true },
      }),
    ]);
    if (
      input.enabled &&
      checksFor(stats, policy, requests, now).every((c) => c.ok)
    )
      eligible += 1;
  }
  return { eligible, members: seats.length };
}
