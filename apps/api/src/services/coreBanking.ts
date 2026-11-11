import { prisma } from "../lib/db.js";

// D113: the MFI's banking system, simulated. A real MFI books each group's
// savings in its own system (its "core banking"); no Togolese MFI offers an
// API for it today, so Novi keeps a stand-in: one account per group, with a
// balance and a statement, booked from the same events as Novi's ledger
// (a payment credited, a pot paid out, an advance returned). It lets the
// console show the MFI's side and compare it with Novi's ledger and with the
// real FedaPay balance. A real connection would replace this file, nothing else.

type Movement = {
  source: "CONTRIBUTION" | "PAYOUT" | "ADVANCE_RETURN";
  sourceId: string;
  groupId: string;
  mfiId: string;
  accountRef: string | null;
  amountFcfa: number; // + in, - out
  label: string;
  at: Date;
};

// 5000 -> "5 000", as on a bank statement.
const formatFcfa = (n: number) => n.toLocaleString("fr-FR").replace(/\s/g, " ");

const OPERATOR: Record<string, string> = { MOOV_TG: "Flooz", TOGOCEL: "Mixx by Yas" };

// What has happened in real money and is not yet booked. Only what the
// console also counts in a group's balance, so the two can be compared.
async function pending(mfiId?: string): Promise<Movement[]> {
  const inMfi = mfiId ? { group: { mfiId } } : {};
  const [paid, pots, returns] = await Promise.all([
    prisma.contribution.findMany({
      where: { status: "PAID", round: inMfi },
      include: { round: { include: { group: true } } },
      orderBy: { paidAt: "asc" },
      take: 2000,
    }),
    prisma.payout.findMany({
      where: { status: "PAID", round: inMfi },
      include: { round: { include: { group: true } } },
      orderBy: { paidAt: "asc" },
      take: 2000,
    }),
    prisma.reserveReturn.findMany({
      where: mfiId ? { group: { mfiId } } : {},
      include: { group: true },
      orderBy: { createdAt: "asc" },
      take: 2000,
    }),
  ]);
  const all: Movement[] = [
    ...paid.map((c) => ({
      source: "CONTRIBUTION" as const,
      sourceId: c.id,
      groupId: c.round.groupId,
      mfiId: c.round.group.mfiId,
      accountRef: c.round.group.mfiAccountRef,
      amountFcfa: c.amountFcfa,
      label:
        `Cotisation tour ${c.round.number} · ${OPERATOR[c.operator] ?? c.operator}` +
        (c.advanceFcfa > 0 ? ` · dont avance ${formatFcfa(c.advanceFcfa)} F` : "") +
        (c.providerRef ? ` · réf. ${c.providerRef}` : ""),
      at: c.paidAt ?? c.requestedAt ?? new Date(0),
    })),
    ...pots.map((p) => ({
      source: "PAYOUT" as const,
      sourceId: p.id,
      groupId: p.round.groupId,
      mfiId: p.round.group.mfiId,
      accountRef: p.round.group.mfiAccountRef,
      amountFcfa: -p.amountFcfa,
      label: `Cagnotte tour ${p.round.number}${p.mfiRef ? ` · réf. ${p.mfiRef.replace(/^fedapay:/, "P-")}` : ""}`,
      at: p.paidAt ?? p.createdAt,
    })),
    ...returns.map((r) => ({
      source: "ADVANCE_RETURN" as const,
      sourceId: r.id,
      groupId: r.groupId,
      mfiId: r.group.mfiId,
      accountRef: r.group.mfiAccountRef,
      amountFcfa: -r.amountFcfa,
      label: "Avance de départ rendue en fin de cycle",
      at: r.createdAt,
    })),
  ];
  if (all.length === 0) return [];
  const booked = new Set(
    (
      await prisma.bankEntry.findMany({
        where: { sourceId: { in: all.map((m) => m.sourceId) } },
        select: { source: true, sourceId: true },
      })
    ).map((e) => `${e.source}:${e.sourceId}`),
  );
  return all.filter((m) => !booked.has(`${m.source}:${m.sourceId}`)).sort((a, b) => a.at.getTime() - b.at.getTime());
}

async function book(m: Movement) {
  await prisma.$transaction(async (tx) => {
    const account =
      (await tx.bankAccount.findUnique({ where: { groupId: m.groupId } })) ??
      (await tx.bankAccount.create({
        data: { groupId: m.groupId, mfiId: m.mfiId, ref: m.accountRef ?? `GRP-${m.groupId.slice(0, 8).toUpperCase()}` },
      }));
    const updated = await tx.bankAccount.update({
      where: { id: account.id },
      data: { balanceFcfa: { increment: m.amountFcfa } },
    });
    await tx.bankEntry.create({
      data: {
        accountId: account.id,
        amountFcfa: m.amountFcfa,
        balanceAfterFcfa: updated.balanceFcfa,
        label: m.label,
        source: m.source,
        sourceId: m.sourceId,
      },
    });
  });
}

// Books every movement not yet booked. Safe to run often and concurrently:
// an entry is unique per movement, so a second booking is refused and its
// whole transaction (balance included) rolls back.
export async function syncCoreBanking(mfiId?: string): Promise<number> {
  let booked = 0;
  for (const m of await pending(mfiId)) {
    try {
      await book(m);
      booked += 1;
    } catch {
      // Booked meanwhile by another run.
    }
  }
  return booked;
}

// ---------- Read by the console ----------

export async function groupAccount(groupId: string) {
  const account = await prisma.bankAccount.findUnique({
    where: { groupId },
    include: { entries: { orderBy: { bookedAt: "desc" }, take: 50 } },
  });
  if (!account) return null;
  return {
    ref: account.ref,
    balanceFcfa: account.balanceFcfa,
    entries: account.entries.map((e) => ({
      bookedAt: e.bookedAt.toISOString(),
      label: e.label,
      amountFcfa: e.amountFcfa,
      balanceAfterFcfa: e.balanceAfterFcfa,
    })),
  };
}

export async function mfiBankTotal(mfiId: string): Promise<{ totalFcfa: number; accounts: number }> {
  const sum = await prisma.bankAccount.aggregate({ where: { mfiId }, _sum: { balanceFcfa: true }, _count: true });
  return { totalFcfa: sum._sum.balanceFcfa ?? 0, accounts: sum._count };
}
