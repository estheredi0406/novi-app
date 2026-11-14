// D113: the three views of the money side by side (our ledger, the MFI's books,
// FedaPay).

import type { ConsoleAccounts, ConsoleGroupAccount } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { groupAccount, mfiBankTotal, syncCoreBanking } from "../coreBanking.js";
import { accountBalance } from "../paymentAccounts.js";
import { getOverview } from "./today.js";

// Novi's ledger, the MFI's books and the real FedaPay balance. They only differ
// for a reason: a pot not confirmed yet, FedaPay's fees, or other money in the
// same account.
export async function getAccounts(mfiId: string): Promise<ConsoleAccounts> {
  await syncCoreBanking(mfiId);
  const [overview, bank, fedapay, inTransit] = await Promise.all([
    getOverview(mfiId),
    mfiBankTotal(mfiId),
    accountBalance(mfiId),
    prisma.payout.aggregate({
      where: { status: { in: ["SENDING", "SENT"] }, round: { group: { mfiId } } },
      _sum: { amountFcfa: true },
    }),
  ]);
  return {
    noviFcfa: overview.balanceFcfa,
    bankFcfa: bank.totalFcfa,
    bankAccounts: bank.accounts,
    fedapay,
    inTransitFcfa: inTransit._sum.amountFcfa ?? 0,
  };
}

export async function getGroupAccount(mfiId: string, groupId: string): Promise<ConsoleGroupAccount | null> {
  const group = await prisma.group.findFirst({ where: { id: groupId, mfiId }, select: { id: true } });
  if (!group) throw new AppError("NOT_FOUND", 404);
  await syncCoreBanking(mfiId);
  return groupAccount(groupId);
}
