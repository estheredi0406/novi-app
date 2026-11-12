import { pilotMode } from "../lib/pilot.js";
import type {
  ConsoleSavings,
  ConsoleSavingsPolicy,
  MySavings,
  PotChoiceView,
  SavingsAccountView,
} from "@novi/shared";
import type { SavingsEntry, SavingsPocket } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { mfi as mfiStandIn } from "../providers/index.js";
import { accountForMfi } from "./paymentAccounts.js";

// D123: a member can keep her pot, or part of it, in a savings account at the
// MFI that holds her group's money, instead of receiving it on her wallet.
//
// The rules, in one place:
// 1. Three days before the round whose pot is hers, she can choose where it
//    goes: all on her wallet (the default), all kept, or a part kept. She can
//    change her mind until the pot is sent.
// 2. Kept money goes into one of two pockets: FREE (she withdraws when she
//    wants) or LOCKED for 3, 6 or 12 months (she cannot withdraw it before;
//    the MFI pays a better rate). The rate is the MFI's, fixed when the money
//    comes in, and Novi shows it; it never sets it.
// 3. One savings account per member per MFI. The first time she keeps money,
//    she agrees that Novi sends the MFI the identity it verified (her name,
//    date of birth, number, and that ANID confirmed her identity); the MFI
//    opens the account from its console. If it is not open when her pot is
//    sent, the whole pot goes to her wallet, as before, and she is told.
// 4. A withdrawal goes only to her own Novi number, like a pot, from the
//    MFI's account. Locked money becomes free on its unlock day. Before that
//    day she can take a whole placement back, but it earns nothing: the app
//    says first what she would get by waiting.
// 5. Interest is shown as an estimate: simple interest, day by day, on each
//    amount at the rate it came in with. The MFI credits it by its own rules.
// 6. A member must have started saving at the MFI before she asks for a loan
//    (SavingsPolicy.requireForLoan, on by default since D125; the MFI can
//    turn it off in the console).
// Novi never holds the money (D2): the MFI does, in its FedaPay balance and
// its own books; Novi records her choices and instructions.

export const CHOICE_OPENS_DAYS = 3;
export const LOCK_MONTHS = [3, 6, 12] as const;
const DAY_MS = 86_400_000;

type Policy = {
  freeBp: number | null;
  lock3Bp: number | null;
  lock6Bp: number | null;
  lock12Bp: number | null;
  requireForLoan: boolean;
};

export async function savingsPolicy(mfiId: string): Promise<Policy> {
  const row = await prisma.savingsPolicy.findUnique({ where: { mfiId } });
  return {
    freeBp: row?.freeBp ?? null,
    lock3Bp: row?.lock3Bp ?? null,
    lock6Bp: row?.lock6Bp ?? null,
    lock12Bp: row?.lock12Bp ?? null,
    requireForLoan: row?.requireForLoan ?? true,
  };
}

export function rateFor(policy: Policy, pocket: SavingsPocket, lockMonths: number | null): number | null {
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

// Her rounds whose pot is hers, not sent yet, from three days before.
async function openChoices(userId: string, now: Date) {
  // D126: the choice opens 3 days before the pot and closes on its day, or
  // as soon as Novi starts handling the pot (held because not full, ready,
  // sent). A pot already past is not a question any more: what she chose
  // stands, and a pot on hold has no amount to split yet.
  // D127: in the pilot, rounds follow each other as soon as they are paid, so
  // the choice is open for the whole round being paid now, whatever its date.
  // D137: a full pot waiting for an officer (READY) is still hers to split:
  // the part she keeps is only read when the pot is first sent. Without this,
  // in the pilot the last payment made the pot READY at once and the
  // question vanished before she could answer it.
  const opens = new Date(now.getTime() + CHOICE_OPENS_DAYS * DAY_MS);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const fast = pilotMode();
  const rounds = await prisma.round.findMany({
    where: {
      beneficiaryId: userId,
      dueDate: fast ? { gte: today } : { gte: today, lte: opens },
      OR: [{ payout: null }, { payout: { status: "READY", keptFcfa: null } }],
      group: { state: "ACTIVE" },
    },
    include: { group: { include: { mfi: true, rulesVersions: { orderBy: { version: "desc" }, take: 1 } } }, payout: true },
    orderBy: { dueDate: "asc" },
  });
  if (!fast) return rounds;
  const current: typeof rounds = [];
  for (const r of rounds) {
    const before = await prisma.round.count({ where: { groupId: r.groupId, number: { lt: r.number }, payout: null } });
    if (before === 0) current.push(r);
  }
  return current;
}

export async function mySavings(userId: string, now = new Date()): Promise<MySavings> {
  const [accounts, rounds] = await Promise.all([
    prisma.savingsAccount.findMany({ where: { userId }, include: { mfi: true, entries: true } }),
    openChoices(userId, now),
  ]);
  const choices = await prisma.potChoice.findMany({ where: { roundId: { in: rounds.map((r) => r.id) } } });
  const pending: PotChoiceView[] = [];
  for (const r of rounds) {
    const rules = r.group.rulesVersions[0];
    if (!rules) continue;
    const policy = await savingsPolicy(r.group.mfiId);
    const account = accounts.find((a) => a.mfiId === r.group.mfiId);
    const choice = choices.find((c) => c.roundId === r.id);
    pending.push({
      roundId: r.id,
      groupId: r.groupId,
      groupName: r.group.name,
      roundNumber: r.number,
      dueDate: r.dueDate.toISOString().slice(0, 10),
      potFcfa: rules.amountFcfa * rules.size,
      mfiName: r.group.mfi.name,
      accountStatus: (account?.status ?? null) as PotChoiceView["accountStatus"],
      keepFcfa: choice?.keepFcfa ?? 0,
      pocket: choice?.pocket ?? "FREE",
      lockMonths: choice?.lockMonths ?? null,
      rates: { freeBp: policy.freeBp, lock3Bp: policy.lock3Bp, lock6Bp: policy.lock6Bp, lock12Bp: policy.lock12Bp },
    });
  }
  return {
    accounts: accounts.map((a) => accountView(a, a.entries, now)),
    choices: pending,
  };
}

// Her choice for one pot. Keeping anything needs her agreement to share her
// verified identity with the MFI, the first time.
export async function choosePot(
  userId: string,
  input: { roundId: string; keepFcfa: number; pocket: SavingsPocket; lockMonths: number | null; consent: boolean },
  now = new Date(),
): Promise<MySavings> {
  const round = (await openChoices(userId, now)).find((r) => r.id === input.roundId);
  if (!round) throw new AppError("NOT_ALLOWED_NOW", 409);
  const rules = round.group.rulesVersions[0];
  const pot = rules ? rules.amountFcfa * rules.size : 0;
  if (!Number.isInteger(input.keepFcfa) || input.keepFcfa < 0 || input.keepFcfa > pot)
    throw new AppError("VALIDATION_FAILED", 400);
  // "All on my phone" needs no length; a placement needs 3, 6 or 12 months.
  if (input.keepFcfa > 0 && input.pocket === "LOCKED" && !LOCK_MONTHS.includes(input.lockMonths as 3 | 6 | 12))
    throw new AppError("VALIDATION_FAILED", 400);

  if (input.keepFcfa > 0) {
    const existing = await prisma.savingsAccount.findUnique({
      where: { userId_mfiId: { userId, mfiId: round.group.mfiId } },
    });
    if (!existing) {
      if (!input.consent) throw new AppError("SAVINGS_CONSENT_REQUIRED", 400);
      const count = await prisma.savingsAccount.count({ where: { mfiId: round.group.mfiId } });
      await prisma.savingsAccount.create({
        data: {
          userId,
          mfiId: round.group.mfiId,
          ref: `EP-${round.group.mfi.code.slice(0, 3)}-${String(count + 1).padStart(4, "0")}`,
          consentAt: now,
        },
      });
      await prisma.auditEvent.create({
        data: { userId, type: "SAVINGS_REQUESTED", details: { mfiId: round.group.mfiId } },
      });
    } else if (existing.status === "REFUSED") {
      throw new AppError("SAVINGS_REFUSED", 409);
    }
  }
  const data = {
    userId,
    keepFcfa: input.keepFcfa,
    pocket: input.pocket,
    lockMonths: input.pocket === "LOCKED" ? input.lockMonths : null,
  };
  await prisma.potChoice.upsert({ where: { roundId: round.id }, create: { roundId: round.id, ...data }, update: data });
  return mySavings(userId, now);
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
  const policy: Policy = {
    freeBp: row?.freeBp ?? null,
    lock3Bp: row?.lock3Bp ?? null,
    lock6Bp: row?.lock6Bp ?? null,
    lock12Bp: row?.lock12Bp ?? null,
    requireForLoan: row?.requireForLoan ?? true,
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
  const ok = await sendWithdrawal(account, out.id, lot.amountFcfa, userId);
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
    policy: await savingsPolicy(mfiId),
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
  return consoleSavings(mfiId, now);
}

export async function saveSavingsPolicy(mfiId: string, staffId: string, input: ConsoleSavingsPolicy): Promise<ConsoleSavings> {
  const data = {
    freeBp: input.freeBp,
    lock3Bp: input.lock3Bp,
    lock6Bp: input.lock6Bp,
    lock12Bp: input.lock12Bp,
    requireForLoan: input.requireForLoan,
  };
  await prisma.savingsPolicy.upsert({ where: { mfiId }, create: { mfiId, ...data }, update: data });
  await prisma.auditEvent.create({ data: { type: "STAFF_SAVINGS_POLICY_CHANGED", details: { staffId, ...data } } });
  return consoleSavings(mfiId);
}
