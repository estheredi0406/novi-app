import { pilotMode } from "../lib/pilot.js";
import type {
  ConsoleSavings,
  ConsoleSavingsPolicy,
  MySavings,
  PotChoiceView,
  SavingsAccountView,
  SavingsTerms,
} from "@novi/shared";
import type { Prisma, SavingsEntry, SavingsPocket } from "../generated/prisma/client.js";
import { potShare } from "../lib/groupRules.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { mfi as mfiStandIn } from "../providers/index.js";
import { accountForMfi } from "./paymentAccounts.js";
import { hasApp, notifyMembers } from "./notifyService.js";
import { savingsDecidedSms } from "../lib/smsText.js";
import { sms } from "../providers/index.js";

// D123: a member can keep her pot, or part of it, in a savings account at the
// MFI that holds her group's money, instead of receiving it on her wallet.
//
// The rules, in one place:
// 1. D147: as soon as she has joined a group, before it starts, Novi asks
//    where her pot goes: all on her wallet (the default if she never
//    answers), all kept, or a part kept, with the caisse's conditions on the
//    same screen. She can change her mind until the pot is sent.
// 1b. D147: the caisse must have set its conditions (rates, fees, minimum,
//    early-withdrawal rule) first: until then it cannot validate a group and
//    Novi offers no savings at all.
// 2. Kept money goes into one of two pockets: FREE (she withdraws when she
//    wants) or LOCKED for 3, 6 or 12 months (she cannot withdraw it before;
//    the MFI pays a better rate). The rate is the MFI's, fixed when the money
//    comes in, and Novi shows it; it never sets it.
// 3. One savings account per member per MFI. The first time she keeps money,
//    she agrees that Novi sends the MFI the identity it verified (her name,
//    date of birth, number, and that ANID confirmed her identity); the MFI
//    opens the account from its console. D141: the pot waits until it is
//    opened; refused, the whole pot goes to her wallet and she is told.
// 4. A withdrawal goes only to her own Novi number, like a pot, from the
//    MFI's account. Locked money becomes free on its unlock day. Before that
//    day she can take a whole placement back on the caisse's early rule (D147:
//    without gains, or less a penalty): the app says first what she would get
//    by waiting.
// 5. Interest is shown as an estimate: simple interest, day by day, on each
//    amount at the rate it came in with. The MFI credits it by its own rules.
// 6. A member must have started saving at the MFI before she asks for a loan
//    (SavingsPolicy.requireForLoan, on by default since D125; the MFI can
//    turn it off in the console).
// Novi never holds the money (D2): the MFI does, in its FedaPay balance and
// its own books; Novi records her choices and instructions.

export const LOCK_MONTHS = [3, 6, 12] as const;
const DAY_MS = 86_400_000;

type Policy = {
  freeBp: number | null;
  lock3Bp: number | null;
  lock6Bp: number | null;
  lock12Bp: number | null;
  requireForLoan: boolean;
  openingFeeFcfa: number | null;
  monthlyFeeFcfa: number | null;
  withdrawalFeeFcfa: number | null;
  minKeepFcfa: number | null;
  earlyRule: "LOSE_GAINS" | "PENALTY" | null;
  earlyPenaltyBp: number | null;
};

export async function savingsPolicy(mfiId: string): Promise<Policy> {
  const row = await prisma.savingsPolicy.findUnique({ where: { mfiId } });
  return {
    freeBp: row?.freeBp ?? null,
    lock3Bp: row?.lock3Bp ?? null,
    lock6Bp: row?.lock6Bp ?? null,
    lock12Bp: row?.lock12Bp ?? null,
    requireForLoan: row?.requireForLoan ?? true,
    openingFeeFcfa: row?.openingFeeFcfa ?? null,
    monthlyFeeFcfa: row?.monthlyFeeFcfa ?? null,
    withdrawalFeeFcfa: row?.withdrawalFeeFcfa ?? null,
    minKeepFcfa: row?.minKeepFcfa ?? null,
    earlyRule: row?.earlyRule ?? null,
    earlyPenaltyBp: row?.earlyPenaltyBp ?? null,
  };
}

// D147: the conditions a member reads, or null while any is missing.
export function termsOf(p: Policy): SavingsTerms | null {
  const locks = (
    [
      [3, p.lock3Bp],
      [6, p.lock6Bp],
      [12, p.lock12Bp],
    ] as const
  )
    .filter(([, bp]) => bp !== null)
    .map(([months, bp]) => ({ months, bp: bp as number }));
  // The app offers blocked savings only (D123: one simple product), so at
  // least one duration with its rate, and the early rule, are required.
  if (locks.length === 0 || p.openingFeeFcfa === null || p.monthlyFeeFcfa === null) return null;
  if (p.withdrawalFeeFcfa === null || p.minKeepFcfa === null) return null;
  if (p.earlyRule === null || (p.earlyRule === "PENALTY" && p.earlyPenaltyBp === null)) return null;
  return {
    freeBp: p.freeBp,
    locks,
    openingFeeFcfa: p.openingFeeFcfa,
    monthlyFeeFcfa: p.monthlyFeeFcfa,
    withdrawalFeeFcfa: p.withdrawalFeeFcfa,
    minKeepFcfa: p.minKeepFcfa,
    early: { rule: p.earlyRule, penaltyBp: p.earlyRule === "PENALTY" ? p.earlyPenaltyBp : null },
  };
}

export async function savingsTerms(mfiId: string): Promise<SavingsTerms | null> {
  return termsOf(await savingsPolicy(mfiId));
}

export function rateFor(policy: Pick<Policy, "freeBp" | "lock3Bp" | "lock6Bp" | "lock12Bp">, pocket: SavingsPocket, lockMonths: number | null): number | null {
  if (pocket === "FREE") return policy.freeBp;
  return lockMonths === 3 ? policy.lock3Bp : lockMonths === 6 ? policy.lock6Bp : lockMonths === 12 ? policy.lock12Bp : null;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

// Simple interest on one amount, from when it came in until `at` (and, when
// locked, no further than its unlock day).
function interestOf(e: SavingsEntry, at: Date): number {
  if (e.kind !== "POT_KEPT" || !e.rateBp || e.brokenAt) return 0;
  const end = e.unlockAt && e.unlockAt < at ? e.unlockAt : at;
  const days = Math.max(0, (end.getTime() - e.createdAt.getTime()) / DAY_MS);
  return (e.amountFcfa * e.rateBp * days) / (10_000 * 365);
}

// What is in the account: free money (kept free, plus locked money past its
// day, minus withdrawals), the locked amounts still waiting, and interest.
export function balances(entries: SavingsEntry[], now: Date) {
  const live = entries.filter((e) => e.status !== "FAILED");
  let free = 0;
  const locked: {
    id: string;
    amountFcfa: number;
    unlockAt: string;
    lockMonths: number;
    rateBp: number | null;
    since: string;
    gainAtEndFcfa: number | null;
  }[] = [];
  for (const e of live) {
    if (e.kind === "POT_KEPT" && e.pocket === "LOCKED" && e.unlockAt && e.unlockAt > now && !e.brokenAt) {
      locked.push({
        id: e.id,
        since: e.createdAt.toISOString(),
        gainAtEndFcfa: e.rateBp ? Math.floor(interestOf(e, e.unlockAt)) : null,
        amountFcfa: e.amountFcfa,
        unlockAt: e.unlockAt.toISOString(),
        lockMonths: e.lockMonths ?? 0,
        rateBp: e.rateBp,
      });
    } else {
      free += e.amountFcfa;
    }
  }
  const lockedTotal = locked.reduce((s, l) => s + l.amountFcfa, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const toDate = live.reduce((s, e) => s + interestOf(e, now), 0);
  const beforeMonth = live.reduce((s, e) => s + (e.createdAt < monthStart ? interestOf(e, monthStart) : 0), 0);
  return {
    freeFcfa: free,
    lockedFcfa: lockedTotal,
    totalFcfa: free + lockedTotal,
    locked,
    interestToDateFcfa: Math.floor(toDate),
    interestThisMonthFcfa: Math.floor(toDate - beforeMonth),
  };
}

function accountView(
  account: { id: string; ref: string; status: string; refusedReason: string | null; mfi: { name: string } },
  entries: SavingsEntry[],
  now: Date,
): SavingsAccountView {
  return {
    id: account.id,
    ref: account.ref,
    mfiName: account.mfi.name,
    status: account.status as SavingsAccountView["status"],
    refusedReason: account.refusedReason,
    ...balances(entries, now),
    entries: entries
      .filter((e) => e.status !== "FAILED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        pocket: e.pocket,
        amountFcfa: e.amountFcfa,
        lockMonths: e.lockMonths,
        unlockAt: e.unlockAt?.toISOString() ?? null,
        status: e.status as "DONE" | "SENDING" | "FAILED",
        early: e.kind === "WITHDRAWAL" && e.pocket === "LOCKED",
        at: e.createdAt.toISOString(),
      })),
  };
}

// Her pots she can still direct (D147): in each group she has joined that
// has not started yet (no round: the choice is kept on her seat), and each
// round of hers in a running group whose pot has not left (no payout yet, or
// a full pot waiting for an officer, D137). Only at a caisse whose savings
// conditions are complete.
type Open = {
  groupId: string;
  roundId: string | null;
  roundNumber: number | null;
  dueDate: Date | null;
  started: boolean;
  group: { name: string; mfiId: string; mfi: { name: string; code: string } };
  potFcfa: number;
  terms: SavingsTerms;
  saved: { keepFcfa: number; pocket: SavingsPocket; lockMonths: number | null } | null;
};

async function openChoices(userId: string, now: Date): Promise<Open[]> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [seats, rounds] = await Promise.all([
    prisma.membership.findMany({
      where: { userId, state: "ACCEPTED", group: { state: { in: ["PROPOSED", "STARTING"] } } },
      include: { group: { include: { mfi: true, rulesVersions: { orderBy: { version: "desc" }, take: 1 } } } },
    }),
    prisma.round.findMany({
      where: {
        beneficiaryId: userId,
        dueDate: { gte: today },
        OR: [{ payout: null }, { payout: { status: "READY", keptFcfa: null } }],
        group: { state: "ACTIVE" },
      },
      include: { group: { include: { mfi: true, rulesVersions: { orderBy: { version: "desc" }, take: 1 } } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);
  const choices = await prisma.potChoice.findMany({ where: { roundId: { in: rounds.map((r) => r.id) } } });
  const termsByMfi = new Map<string, SavingsTerms | null>();
  const termsFor = async (mfiId: string) => {
    if (!termsByMfi.has(mfiId)) termsByMfi.set(mfiId, await savingsTerms(mfiId));
    return termsByMfi.get(mfiId) ?? null;
  };
  const out: Open[] = [];
  for (const seat of seats) {
    const rules = seat.group.rulesVersions[0];
    const terms = await termsFor(seat.group.mfiId);
    if (!rules || !terms) continue;
    out.push({
      groupId: seat.groupId,
      roundId: null,
      roundNumber: null,
      dueDate: null,
      started: false,
      group: seat.group,
      potFcfa: potShare(rules.amountFcfa) * rules.size,
      terms,
      saved:
        seat.potChoiceAt && seat.potKeepFcfa !== null
          ? { keepFcfa: seat.potKeepFcfa, pocket: seat.potPocket ?? "FREE", lockMonths: seat.potLockMonths }
          : null,
    });
  }
  for (const r of rounds) {
    const rules = r.group.rulesVersions[0];
    const terms = await termsFor(r.group.mfiId);
    if (!rules || !terms) continue;
    const c = choices.find((x) => x.roundId === r.id && x.userId === userId);
    out.push({
      groupId: r.groupId,
      roundId: r.id,
      roundNumber: r.number,
      dueDate: r.dueDate,
      started: true,
      group: r.group,
      potFcfa: potShare(rules.amountFcfa) * rules.size,
      terms,
      saved: c ? { keepFcfa: c.keepFcfa, pocket: c.pocket, lockMonths: c.lockMonths } : null,
    });
  }
  return out;
}

export async function mySavings(userId: string, now = new Date()): Promise<MySavings> {
  const [accounts, open] = await Promise.all([
    prisma.savingsAccount.findMany({ where: { userId }, include: { mfi: true, entries: true } }),
    openChoices(userId, now),
  ]);
  const pending: PotChoiceView[] = open.map((o) => {
    const account = accounts.find((a) => a.mfiId === o.group.mfiId);
    const lock = (m: number) => o.terms.locks.find((l) => l.months === m)?.bp ?? null;
    return {
      roundId: o.roundId,
      groupId: o.groupId,
      groupName: o.group.name,
      roundNumber: o.roundNumber,
      dueDate: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
      started: o.started,
      potFcfa: o.potFcfa,
      mfiName: o.group.mfi.name,
      accountStatus: (account?.status ?? null) as PotChoiceView["accountStatus"],
      chosen: Boolean(o.saved),
      keepFcfa: o.saved?.keepFcfa ?? 0,
      pocket: o.saved?.pocket ?? "FREE",
      lockMonths: o.saved?.lockMonths ?? null,
      rates: { freeBp: o.terms.freeBp, lock3Bp: lock(3), lock6Bp: lock(6), lock12Bp: lock(12) },
      terms: o.terms,
    };
  });
  return {
    accounts: accounts.map((a) => accountView(a, a.entries, now)),
    choices: pending,
  };
}

type ChoiceInput = { keepFcfa: number; pocket: SavingsPocket; lockMonths: number | null; consent: boolean };

// Her choice for one pot, by its round (running group) or by its group (D147:
// before the start, or her round in a running group). Keeping anything needs
// her agreement to share her verified identity with the MFI, the first time;
// the account is asked for at once, so the caisse can open it long before her
// turn.
export async function choosePot(
  userId: string,
  input: ChoiceInput & ({ roundId: string } | { groupId: string }),
  now = new Date(),
): Promise<MySavings> {
  const open = (await openChoices(userId, now)).find((o) =>
    "roundId" in input ? o.roundId === input.roundId : o.groupId === input.groupId,
  );
  if (!open) {
    // A caisse without complete conditions offers no savings at all.
    const groupId = "groupId" in input ? input.groupId : null;
    if (groupId) {
      const g = await prisma.group.findUnique({ where: { id: groupId } });
      if (g && !(await savingsTerms(g.mfiId))) throw new AppError("SAVINGS_TERMS_MISSING", 409);
    }
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  const { terms } = open;
  if (!Number.isInteger(input.keepFcfa) || input.keepFcfa < 0 || input.keepFcfa > open.potFcfa)
    throw new AppError("VALIDATION_FAILED", 400);
  if (input.keepFcfa > 0 && input.keepFcfa < terms.minKeepFcfa) throw new AppError("VALIDATION_FAILED", 400);
  // "All on my phone" needs no length; a placement needs a duration the caisse offers.
  if (input.keepFcfa > 0 && input.pocket === "LOCKED" && !terms.locks.some((l) => l.months === input.lockMonths))
    throw new AppError("VALIDATION_FAILED", 400);

  if (input.keepFcfa > 0) await requestAccount(userId, open.group, input.consent, now);
  const data = {
    keepFcfa: input.keepFcfa,
    pocket: input.pocket,
    lockMonths: input.keepFcfa > 0 && input.pocket === "LOCKED" ? input.lockMonths : null,
  };
  if (open.roundId) {
    await prisma.potChoice.upsert({
      where: { roundId: open.roundId },
      create: { roundId: open.roundId, userId, ...data },
      update: { userId, ...data },
    });
  } else {
    await prisma.membership.updateMany({
      where: { groupId: open.groupId, userId },
      data: { potKeepFcfa: data.keepFcfa, potPocket: data.pocket, potLockMonths: data.lockMonths, potChoiceAt: now },
    });
  }
  return mySavings(userId, now);
}

async function requestAccount(
  userId: string,
  group: { mfiId: string; mfi: { code: string } },
  consent: boolean,
  now: Date,
) {
  const existing = await prisma.savingsAccount.findUnique({
    where: { userId_mfiId: { userId, mfiId: group.mfiId } },
  });
  if (existing?.status === "REFUSED") throw new AppError("SAVINGS_REFUSED", 409);
  if (existing) return;
  if (!consent) throw new AppError("SAVINGS_CONSENT_REQUIRED", 400);
  const count = await prisma.savingsAccount.count({ where: { mfiId: group.mfiId } });
  await prisma.savingsAccount.create({
    data: {
      userId,
      mfiId: group.mfiId,
      ref: `EP-${group.mfi.code.slice(0, 3)}-${String(count + 1).padStart(4, "0")}`,
      consentAt: now,
    },
  });
  await prisma.auditEvent.create({
    data: { userId, type: "SAVINGS_REQUESTED", details: { mfiId: group.mfiId } },
  });
}

// D147: when the calendar is written, each choice made before the start
// becomes the choice for that member's round.
export async function carryChoices(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  const seats = await tx.membership.findMany({
    where: { groupId, potChoiceAt: { not: null }, potKeepFcfa: { not: null } },
  });
  for (const seat of seats) {
    const round = await tx.round.findFirst({ where: { groupId, beneficiaryId: seat.userId } });
    if (!round) continue;
    await tx.potChoice.upsert({
      where: { roundId: round.id },
      create: {
        roundId: round.id,
        userId: seat.userId,
        keepFcfa: seat.potKeepFcfa ?? 0,
        pocket: seat.potPocket ?? "FREE",
        lockMonths: seat.potLockMonths,
      },
      update: {},
    });
  }
}

// D141: she chose to keep part of this pot in savings and the MFI has not
// opened her account yet: the pot waits (no release, no auto-release, no
// retry) until an officer opens the account, or refuses it (then all of it
// goes to her phone). Returns the amount she keeps, or 0 if nothing waits.
export async function savingsToOpen(payoutId: string): Promise<number> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { round: { include: { group: true } } },
  });
  if (!payout || payout.toNextOfKin || payout.keptFcfa !== null) return 0;
  const choice = await prisma.potChoice.findUnique({ where: { roundId: payout.roundId } });
  if (!choice || choice.userId !== payout.beneficiaryId || choice.keepFcfa <= 0) return 0;
  const account = await prisma.savingsAccount.findUnique({
    where: { userId_mfiId: { userId: payout.beneficiaryId, mfiId: payout.round.group.mfiId } },
  });
  return account?.status === "REQUESTED" ? choice.keepFcfa : 0;
}

// Called once, when a pot is first sent: how much of it stays in her savings.
// Nothing if she did not choose, if her account is not open, or if the pot
// goes to her next of kin.
export async function keptForPayout(payoutId: string): Promise<number> {
  const payout = await prisma.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { round: { include: { group: true } } },
  });
  if (payout.keptFcfa !== null) return payout.keptFcfa;
  let kept = 0;
  if (!payout.toNextOfKin) {
    const choice = await prisma.potChoice.findUnique({ where: { roundId: payout.roundId } });
    if (choice && choice.userId === payout.beneficiaryId && choice.keepFcfa > 0) {
      const account = await prisma.savingsAccount.findUnique({
        where: { userId_mfiId: { userId: payout.beneficiaryId, mfiId: payout.round.group.mfiId } },
      });
      if (account?.status === "OPEN") kept = Math.min(choice.keepFcfa, payout.amountFcfa);
    }
  }
  await prisma.payout.updateMany({ where: { id: payoutId, keptFcfa: null }, data: { keptFcfa: kept } });
  const saved = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId }, select: { keptFcfa: true } });
  return saved.keptFcfa ?? 0;
}

// Inside the payout's settlement: the kept part becomes a savings entry.
export async function bookKept(
  tx: Pick<typeof prisma, "payout" | "potChoice" | "savingsAccount" | "savingsEntry" | "savingsPolicy">,
  payoutId: string,
  now: Date,
): Promise<void> {
  const payout = await tx.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: { round: { include: { group: true } } },
  });
  const kept = payout.keptFcfa ?? 0;
  if (kept <= 0) return;
  const choice = await tx.potChoice.findUnique({ where: { roundId: payout.roundId } });
  const account = await tx.savingsAccount.findUniqueOrThrow({
    where: { userId_mfiId: { userId: payout.beneficiaryId, mfiId: payout.round.group.mfiId } },
  });
  const pocket = choice?.pocket ?? "FREE";
  const lockMonths = pocket === "LOCKED" ? (choice?.lockMonths ?? 3) : null;
  const row = await tx.savingsPolicy.findUnique({ where: { mfiId: payout.round.group.mfiId } });
  const policy = {
    freeBp: row?.freeBp ?? null,
    lock3Bp: row?.lock3Bp ?? null,
    lock6Bp: row?.lock6Bp ?? null,
    lock12Bp: row?.lock12Bp ?? null,
  };
  await tx.savingsEntry.create({
    data: {
      accountId: account.id,
      kind: "POT_KEPT",
      pocket,
      amountFcfa: kept,
      rateBp: rateFor(policy, pocket, lockMonths),
      lockMonths,
      unlockAt: lockMonths ? addMonths(now, lockMonths) : null,
      payoutId,
    },
  });
}

// A withdrawal from her free money, sent to her own number from the MFI's
// account, like a pot. A refused transfer gives the money back to her balance.
export async function withdraw(userId: string, input: { accountId: string; amountFcfa: number }, now = new Date()) {
  const account = await prisma.savingsAccount.findFirst({
    where: { id: input.accountId, userId },
    include: { entries: true, user: true },
  });
  if (!account || account.status !== "OPEN") throw new AppError("NOT_FOUND", 404);
  if (input.amountFcfa < 500 || input.amountFcfa % 500 !== 0) throw new AppError("VALIDATION_FAILED", 400);
  const { freeFcfa } = balances(account.entries, now);
  if (input.amountFcfa > freeFcfa) throw new AppError("SAVINGS_NOT_ENOUGH", 409);
  const entry = await prisma.savingsEntry.create({
    data: { accountId: account.id, kind: "WITHDRAWAL", pocket: "FREE", amountFcfa: -input.amountFcfa, status: "SENDING" },
  });
  if (!(await sendWithdrawal(account, entry.id, input.amountFcfa, userId)))
    throw new AppError("SAVINGS_WITHDRAWAL_FAILED", 502);
  return mySavings(userId, now);
}

// D123: she takes a whole placement back before its date. It earns nothing;
// the transfer goes to her own number like any withdrawal, and a refused
// transfer puts the placement back as it was.
export async function breakPlacement(userId: string, input: { accountId: string; entryId: string }, now = new Date()) {
  const account = await prisma.savingsAccount.findFirst({
    where: { id: input.accountId, userId, status: "OPEN" },
    include: { user: true },
  });
  if (!account) throw new AppError("NOT_FOUND", 404);
  const lot = await prisma.savingsEntry.findFirst({
    where: { id: input.entryId, accountId: account.id, kind: "POT_KEPT", pocket: "LOCKED", brokenAt: null },
  });
  if (!lot || !lot.unlockAt || lot.unlockAt <= now) throw new AppError("NOT_FOUND", 404);
  const claimed = await prisma.savingsEntry.updateMany({ where: { id: lot.id, brokenAt: null }, data: { brokenAt: now } });
  if (claimed.count === 0) throw new AppError("NOT_FOUND", 404);
  const out = await prisma.savingsEntry.create({
    data: { accountId: account.id, kind: "WITHDRAWAL", pocket: "LOCKED", amountFcfa: -lot.amountFcfa, status: "SENDING" },
  });
  // D147: the caisse's early rule: without gains (the default), or less its
  // penalty, which the caisse keeps.
  const policy = await savingsPolicy(account.mfiId);
  const penalty =
    policy.earlyRule === "PENALTY" && policy.earlyPenaltyBp
      ? Math.ceil((lot.amountFcfa * policy.earlyPenaltyBp) / 10_000)
      : 0;
  const ok = await sendWithdrawal(account, out.id, lot.amountFcfa - penalty, userId);
  if (!ok) {
    await prisma.savingsEntry.update({ where: { id: lot.id }, data: { brokenAt: null } });
    throw new AppError("SAVINGS_WITHDRAWAL_FAILED", 502);
  }
  return mySavings(userId, now);
}

async function sendWithdrawal(
  account: { id: string; mfiId: string; ref: string; user: { phone: string } },
  entryId: string,
  amountFcfa: number,
  userId: string,
): Promise<boolean> {
  const lastPot = await prisma.payout.findFirst({
    where: { beneficiaryId: userId, round: { group: { mfiId: account.mfiId } } },
    orderBy: { createdAt: "desc" },
    select: { operator: true },
  });
  try {
    const payAccount = await accountForMfi(account.mfiId).catch(() => null);
    const sender = payAccount?.sentVia === "fedapay" ? payAccount.payouts : mfiStandIn;
    const answer = await sender.sendPayout({
      payoutId: entryId,
      accountRef: account.ref,
      amountFcfa,
      phone: account.user.phone,
      operator: lastPot?.operator ?? "TOGOCEL",
    });
    const failed = answer.status === "FAILED";
    await prisma.savingsEntry.update({ where: { id: entryId }, data: { status: failed ? "FAILED" : "DONE", mfiRef: answer.mfiRef } });
    return !failed;
  } catch {
    await prisma.savingsEntry.update({ where: { id: entryId }, data: { status: "FAILED" } });
    return false;
  }
}

// Whether she has started saving at this MFI (for the loan condition).
export async function hasSaved(userId: string, mfiId: string): Promise<boolean> {
  const n = await prisma.savingsEntry.count({
    where: { kind: "POT_KEPT", account: { userId, mfiId, status: "OPEN" } },
  });
  return n > 0;
}

// ---------- The MFI's side ----------

export async function consoleSavings(mfiId: string, now = new Date()): Promise<ConsoleSavings> {
  const accounts = await prisma.savingsAccount.findMany({
    where: { mfiId },
    include: { user: true, entries: true },
    orderBy: { createdAt: "asc" },
  });
  // The pot each requester waits for, so the officer opens the urgent ones first.
  const nextPots = await prisma.round.findMany({
    where: {
      beneficiaryId: { in: accounts.filter((a) => a.status === "REQUESTED").map((a) => a.userId) },
      group: { mfiId, state: "ACTIVE" },
      OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
    },
    orderBy: { dueDate: "asc" },
    select: { id: true, beneficiaryId: true, dueDate: true },
  });
  const wishes = await prisma.potChoice.findMany({ where: { roundId: { in: nextPots.map((p) => p.id) } } });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const all = accounts.flatMap((a) => a.entries).filter((e) => e.status !== "FAILED");
  return {
    totalFcfa: all.reduce((s, e) => s + e.amountFcfa, 0),
    openAccounts: accounts.filter((a) => a.status === "OPEN").length,
    keptThisMonthFcfa: all.filter((e) => e.kind === "POT_KEPT" && e.createdAt >= monthStart).reduce((s, e) => s + e.amountFcfa, 0),
    withdrawnThisMonthFcfa: -all.filter((e) => e.kind === "WITHDRAWAL" && e.createdAt >= monthStart).reduce((s, e) => s + e.amountFcfa, 0),
    requests: accounts
      .filter((a) => a.status === "REQUESTED")
      .map((a) => ({
        id: a.id,
        ref: a.ref,
        // D33: what the MFI needs to open the account, which she agreed to share.
        legalName: a.user.legalName,
        phone: a.user.phone,
        idVerifiedAt: a.user.idVerifiedAt.toISOString(),
        requestedAt: a.createdAt.toISOString(),
        potDate: nextPots.find((p) => p.beneficiaryId === a.userId)?.dueDate.toISOString().slice(0, 10) ?? null,
        // What she asked to place from that pot, and for how long.
        ...(() => {
          const pot = nextPots.find((p) => p.beneficiaryId === a.userId);
          const wish = pot ? wishes.find((w) => w.roundId === pot.id) : undefined;
          return { keepFcfa: wish?.keepFcfa ?? null, lockMonths: wish?.lockMonths ?? null };
        })(),
      })),
    accounts: accounts
      .filter((a) => a.status === "OPEN")
      .map((a) => {
        const b = balances(a.entries, now);
        const last = [...a.entries].filter((e) => e.status !== "FAILED").sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
        return {
          id: a.id,
          ref: a.ref,
          totalFcfa: b.totalFcfa,
          lockedFcfa: b.lockedFcfa,
          interestToDateFcfa: b.interestToDateFcfa,
          lastKind: last?.kind ?? null,
          lastAmountFcfa: last?.amountFcfa ?? null,
          lastAt: last?.createdAt.toISOString() ?? null,
          sending: a.entries.some((e) => e.status === "SENDING"),
        };
      }),
    withdrawals: accounts
      .flatMap((a) => a.entries.filter((e) => e.kind === "WITHDRAWAL").map((e) => ({ e, ref: a.ref })))
      .sort((x, y) => y.e.createdAt.getTime() - x.e.createdAt.getTime())
      .slice(0, 20)
      .map(({ e, ref }) => ({
        ref,
        amountFcfa: -e.amountFcfa,
        early: e.pocket === "LOCKED",
        status: e.status as "DONE" | "SENDING" | "FAILED",
        at: e.createdAt.toISOString(),
      })),
    policy: await consolePolicy(mfiId),
  };
}

export async function decideAccount(
  mfiId: string,
  staffId: string,
  accountId: string,
  decision: { open: true } | { open: false; reason: string },
  now = new Date(),
): Promise<ConsoleSavings> {
  const account = await prisma.savingsAccount.findFirst({ where: { id: accountId, mfiId, status: "REQUESTED" } });
  if (!account) throw new AppError("NOT_FOUND", 404);
  await prisma.savingsAccount.update({
    where: { id: account.id },
    data: decision.open
      ? { status: "OPEN", openedAt: now, decidedById: staffId }
      : { status: "REFUSED", decidedById: staffId, refusedReason: decision.reason },
  });
  await prisma.auditEvent.create({
    data: {
      userId: account.userId,
      type: decision.open ? "STAFF_SAVINGS_OPENED" : "STAFF_SAVINGS_REFUSED",
      details: { staffId, accountId: account.id, ref: account.ref },
    },
  });
  await tellSavingsDecided(account.userId, mfiId, decision.open, account.ref);
  return consoleSavings(mfiId, now);
}

// D143: she hears at once that her account is open (her pot can now leave
// with her part kept), or that it was refused (her pot goes to her phone):
// a notification, and an SMS if she has no app. Never stops the decision.
async function tellSavingsDecided(userId: string, mfiId: string, open: boolean, ref: string) {
  try {
    const [user, mfiRow] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, language: true } }),
      prisma.mfi.findUniqueOrThrow({ where: { id: mfiId }, select: { name: true } }),
    ]);
    const name = mfiRow.name;
    await notifyMembers(
      [userId],
      "money",
      "/savings",
      open
        ? { title: "Votre compte d'épargne est ouvert", body: `${name} a ouvert votre compte ${ref}. La part de votre cagnotte choisie y sera placée.` }
        : { title: "Compte d'épargne non ouvert", body: `${name} n'a pas ouvert votre compte. Toute votre cagnotte ira sur votre téléphone.` },
      open
        ? { title: "Your savings account is open", body: `${name} opened your account ${ref}. The part of your pot you chose will be placed there.` }
        : { title: "Savings account not opened", body: `${name} did not open your account. Your whole pot will go to your phone.` },
    );
    if (!(await hasApp(userId))) await sms.send(user.phone, savingsDecidedSms(user.language, name, open, ref));
  } catch (err) {
    console.error("Savings decision not told to the member:", err);
  }
}

async function consolePolicy(mfiId: string): Promise<ConsoleSavingsPolicy> {
  const p = await savingsPolicy(mfiId);
  return { ...p, complete: termsOf(p) !== null };
}

export async function saveSavingsPolicy(
  mfiId: string,
  staffId: string,
  input: Omit<ConsoleSavingsPolicy, "complete">,
): Promise<ConsoleSavings> {
  const data = {
    freeBp: input.freeBp,
    lock3Bp: input.lock3Bp,
    lock6Bp: input.lock6Bp,
    lock12Bp: input.lock12Bp,
    requireForLoan: input.requireForLoan,
    openingFeeFcfa: input.openingFeeFcfa,
    monthlyFeeFcfa: input.monthlyFeeFcfa,
    withdrawalFeeFcfa: input.withdrawalFeeFcfa,
    minKeepFcfa: input.minKeepFcfa,
    earlyRule: input.earlyRule,
    earlyPenaltyBp: input.earlyRule === "PENALTY" ? input.earlyPenaltyBp : null,
  };
  // D147: the date the conditions became complete, for the record.
  const complete = termsOf({ ...data }) !== null;
  Object.assign(data, { termsSetAt: complete ? new Date() : null });
  await prisma.savingsPolicy.upsert({ where: { mfiId }, create: { mfiId, ...data }, update: data });
  await prisma.auditEvent.create({ data: { type: "STAFF_SAVINGS_POLICY_CHANGED", details: { staffId, ...data } } });
  return consoleSavings(mfiId);
}
