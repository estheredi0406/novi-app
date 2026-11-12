import type { ConsoleMoney } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { getAccounts } from "./consoleService.js";

// D124: where the MFI's money is, and what does not match (canvas boards 40
// and 42, simplified). One page answers three questions for the officer:
// 1. How much is there? Novi's ledger for the groups, the group accounts in
//    the MFI's books (D113), the members' placed savings (D123), and the real
//    balance FedaPay reports for the MFI's account. FedaPay's balance should be
//    the groups' money plus the savings, less FedaPay's fees and what the MFI
//    already moved to its bank; Novi shows the figures side by side, it does
//    not move money to the bank (the MFI does that in its FedaPay dashboard).
// 2. What moved today, each line with where the money is now.
// 3. What needs a person: a payment FedaPay confirmed for another amount than
//    asked. Novi credits nothing then (moneyService.settle) and, until now, the
//    officer never saw it: it was only in the log. Reported payments and
//    failed transfers keep their own queues (D105, D114).
// The MFI sees seats and rounds, not names (D33).

const DAY_MS = 86_400_000;

export async function getMoney(mfiId: string, now = new Date()): Promise<ConsoleMoney> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const inMfi = { round: { group: { mfiId } } };
  const [accounts, savings, contributions, payouts, withdrawals, mismatches, resolved] = await Promise.all([
    getAccounts(mfiId),
    prisma.savingsEntry.aggregate({
      where: { status: { not: "FAILED" }, account: { mfiId } },
      _sum: { amountFcfa: true },
    }),
    prisma.contribution.findMany({
      where: { ...inMfi, requestedAt: { gte: dayStart } },
      include: { round: { include: { group: true } } },
      orderBy: { requestedAt: "desc" },
      take: 200,
    }),
    prisma.payout.findMany({
      where: { ...inMfi, OR: [{ paidAt: { gte: dayStart } }, { requestedAt: { gte: dayStart } }] },
      include: { round: { include: { group: true } } },
      take: 100,
    }),
    prisma.savingsEntry.findMany({
      where: { kind: "WITHDRAWAL", createdAt: { gte: dayStart }, account: { mfiId } },
      include: { account: true },
      take: 100,
    }),
    prisma.auditEvent.findMany({
      where: { type: "PAYMENT_AMOUNT_MISMATCH", createdAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.auditEvent.findMany({ where: { type: "STAFF_MISMATCH_RESOLVED" }, select: { details: true }, take: 1000 }),
  ]);

  // The seat that paid, by her turn to receive (D117).
  const seatIds = [...new Set(contributions.map((c) => `${c.round.groupId}:${c.userId}`))];
  const seats = seatIds.length
    ? await prisma.membership.findMany({
        where: { OR: seatIds.map((s) => ({ groupId: s.split(":")[0], userId: s.split(":")[1] })) },
        select: { groupId: true, userId: true, payoutPosition: true },
      })
    : [];
  const turnOf = (groupId: string, userId: string) =>
    seats.find((s) => s.groupId === groupId && s.userId === userId)?.payoutPosition ?? null;

  const movements: ConsoleMoney["today"] = [
    ...contributions.map((c) => ({
      at: (c.paidAt ?? c.requestedAt).toISOString(),
      kind: "CONTRIBUTION" as const,
      groupId: c.round.groupId,
      groupName: c.round.group.name,
      round: c.round.number,
      seat: turnOf(c.round.groupId, c.userId),
      amountFcfa: c.amountFcfa,
      ref: c.providerRef,
      where:
        c.status === "PAID"
          ? ("GROUP_ACCOUNT" as const)
          : c.status === "PENDING"
            ? c.reportedAt
              ? ("REPORTED" as const)
              : ("WAITING" as const)
            : ("FAILED" as const),
    })),
    ...payouts.map((p) => ({
      at: (p.paidAt ?? p.requestedAt ?? p.createdAt).toISOString(),
      kind: "PAYOUT" as const,
      groupId: p.round.groupId,
      groupName: p.round.group.name,
      round: p.round.number,
      seat: p.round.number,
      amountFcfa: -(p.amountFcfa - (p.keptFcfa ?? 0)),
      keptFcfa: p.keptFcfa ?? 0,
      ref: p.mfiRef,
      where:
        p.status === "PAID"
          ? ("SENT" as const)
          : p.status === "FAILED"
            ? ("FAILED" as const)
            : ("SENDING" as const),
    })),
    ...withdrawals.map((w) => ({
      at: w.createdAt.toISOString(),
      kind: "SAVINGS_WITHDRAWAL" as const,
      groupId: null,
      groupName: w.account.ref,
      round: null,
      seat: null,
      amountFcfa: w.amountFcfa,
      ref: w.mfiRef,
      where: w.status === "DONE" ? ("SENT" as const) : w.status === "FAILED" ? ("FAILED" as const) : ("SENDING" as const),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Amount mismatches in this MFI's groups, not marked handled yet.
  const handled = new Set(resolved.map((r) => (r.details as { contributionId?: string } | null)?.contributionId));
  const ids = mismatches
    .map((m) => (m.details as { contributionId?: string } | null)?.contributionId)
    .filter((id): id is string => !!id && !handled.has(id));
  const rows = ids.length
    ? await prisma.contribution.findMany({
        where: { id: { in: ids }, ...inMfi },
        include: { round: { include: { group: true } } },
      })
    : [];
  const toCheck: ConsoleMoney["toCheck"] = rows.map((c) => {
    const ev = mismatches.find((m) => (m.details as { contributionId?: string }).contributionId === c.id);
    const details = ev?.details as { expected: number; received: number };
    return {
      contributionId: c.id,
      at: (ev?.createdAt ?? c.requestedAt).toISOString(),
      groupId: c.round.groupId,
      groupName: c.round.group.name,
      round: c.round.number,
      seat: null,
      expectedFcfa: details.expected,
      receivedFcfa: details.received,
      ref: c.providerRef,
      paidNow: c.status === "PAID",
    };
  });

  // A payment waiting for an officer because the amount differs says so.
  const open = new Set(toCheck.filter((c) => !c.paidNow).map((c) => c.ref));
  for (const m of movements) if (m.kind === "CONTRIBUTION" && m.ref && open.has(m.ref)) m.where = "MISMATCH";

  const savingsFcfa = savings._sum.amountFcfa ?? 0;
  return {
    ...accounts,
    savingsFcfa,
    owedFcfa: accounts.noviFcfa + savingsFcfa,
    today: movements,
    toCheck,
  };
}

// The officer looked into a mismatch with FedaPay and settled it with the
// member (refund or top-up); it leaves the list, and the journal keeps who.
export async function resolveMismatch(mfiId: string, staffId: string, contributionId: string, note: string) {
  const c = await prisma.contribution.findFirst({ where: { id: contributionId, round: { group: { mfiId } } } });
  if (!c) throw new AppError("NOT_FOUND", 404);
  await prisma.auditEvent.create({
    data: { userId: c.userId, type: "STAFF_MISMATCH_RESOLVED", details: { staffId, contributionId, note } },
  });
  return getMoney(mfiId);
}
