import { randomUUID } from "node:crypto";
import type { GroupAccountRequest, MfiAdapter, PayoutAnswer, PayoutRequest } from "./MfiAdapter.js";

// Stands in for the partner MFI until it offers an API (brief: FUCEC-Togo has
// none today). Keeps accounts and transfers in memory so tests can read what
// the MFI was told, and can be made to fail once, as a real MFI sometimes will.
export class MockMfiAdapter implements MfiAdapter {
  readonly accounts = new Map<string, { accountRef: string; request: GroupAccountRequest }>();
  readonly payouts = new Map<string, PayoutRequest & PayoutAnswer>(); // by payoutId
  failNext = false;
  // How the next transfer is answered: at once (PAID), later (SENT), or refused.
  nextPayout: "PAID" | "SENT" | "FAILED" = "PAID";

  async openGroupAccount(request: GroupAccountRequest): Promise<{ accountRef: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("mock MFI unavailable");
    }
    const existing = this.accounts.get(request.groupId);
    if (existing) return { accountRef: existing.accountRef };

    const accountRef = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.accounts.set(request.groupId, { accountRef, request });
    console.log(`[mock MFI] opened ${accountRef} for group ${request.groupId}`);
    return { accountRef };
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutAnswer> {
    // The same payoutId is the same transfer, unless it failed: a failed
    // transfer can be asked again.
    const existing = this.payouts.get(request.payoutId);
    if (existing && existing.status !== "FAILED") return { mfiRef: existing.mfiRef, status: existing.status };

    const status = this.nextPayout;
    this.nextPayout = "PAID";
    const answer: PayoutAnswer = { mfiRef: `MOCKPAY-${randomUUID().slice(0, 8).toUpperCase()}`, status };
    this.payouts.set(request.payoutId, { ...request, ...answer });
    console.log(`[mock MFI] payout of ${request.amountFcfa} FCFA to ${request.phone}: ${status}`);
    return answer;
  }

  async getPayoutStatus(mfiRef: string): Promise<PayoutAnswer> {
    const transfer = [...this.payouts.values()].find((p) => p.mfiRef === mfiRef);
    if (!transfer) throw new Error(`unknown mock transfer ${mfiRef}`);
    return { mfiRef, status: transfer.status };
  }

  // Tests: the MFI confirms (or refuses) a transfer it had accepted.
  settlePayout(payoutId: string, status: "PAID" | "FAILED") {
    const transfer = this.payouts.get(payoutId);
    if (!transfer) throw new Error(`unknown mock payout ${payoutId}`);
    transfer.status = status;
  }
}
