// What Novi asks of the MFI that holds a group's money (D34). The MFI is told
// what it needs to hold and pay out the money, and nothing about who pays
// what: group totals only, no names or phone numbers (D33). The one personal
// detail it receives is the number a pot is sent to, because it must send it.
export type GroupAccountRequest = {
  groupId: string; // Novi's reference; sent again on a retry, so one group never gets two accounts
  contributionFcfa: number; // what each member pays each time
  members: number;
  frequency: "WEEKLY" | "MONTHLY";
};

// An instruction to send one round's pot from the group's account to the
// mobile money wallet of the member whose turn it is (Sprint 4).
export type PayoutRequest = {
  payoutId: string; // Novi's reference; sent again on a retry, so a pot is never sent twice
  accountRef: string; // the group's account at the MFI
  amountFcfa: number;
  phone: string;
  operator: "MOOV_TG" | "TOGOCEL";
};

// SENT: the MFI accepted the instruction and will confirm later.
// PAID: the money has reached her wallet.
export type PayoutAnswer = { mfiRef: string; status: "SENT" | "PAID" | "FAILED" };

export interface MfiAdapter {
  // Opens the group's account and returns the MFI's reference for it.
  // Calling it again for the same groupId returns the same account.
  openGroupAccount(request: GroupAccountRequest): Promise<{ accountRef: string }>;

  // Sends a pot. Calling it again with the same payoutId returns the same
  // transfer instead of sending the money a second time; only a transfer
  // that FAILED is attempted again.
  sendPayout(request: PayoutRequest): Promise<PayoutAnswer>;

  // Asks the MFI what happened to a transfer it accepted earlier.
  getPayoutStatus(mfiRef: string): Promise<PayoutAnswer>;
}
