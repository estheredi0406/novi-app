// What the app receives about money: rounds, payments and the ledger.
// Amounts are whole FCFA (D4). Dates are "YYYY-MM-DD" (Togo uses GMT).

export type MobileOperator = "MOOV_TG" | "TOGOCEL";
export type ContributionStatus = "PENDING" | "PAID" | "FAILED";

// Where a round's pot is (Sprint 4). NOT_DUE: its day has not come yet.
// HELD: the day has passed but someone has not paid; nothing is sent short.
// READY: due and full, waiting for the MFI officer to release it (D63).
export type PayoutStatus = "NOT_DUE" | "HELD" | "READY" | "SENDING" | "SENT" | "PAID" | "FAILED";

// Her own payment for one round, as she sees it while paying and after.
export type ContributionView = {
  id: string;
  roundNumber: number;
  amountFcfa: number;
  operator: MobileOperator;
  status: ContributionStatus;
  requestedAt: string;
  paidAt: string | null;
  receiptRef: string | null; // short reference printed on the receipt, once paid
  // Only in the answer to "pay": the provider's payment page, when she pays
  // there instead of approving a request on her phone (FedaPay checkout).
  paymentUrl: string | null;
};

// One round in the group's calendar.
export type RoundSummary = {
  number: number;
  dueDate: string;
  beneficiaryName: string; // whose turn it is: the pot goes to her
  isCurrent: boolean; // the round open for payment today
  paidCount: number;
  size: number;
  collectedFcfa: number; // paid so far
  potFcfa: number; // what the round collects once everyone has paid
  myStatus: ContributionStatus | "UNPAID";
  payoutStatus: PayoutStatus;
  paidOutAt: string | null; // when the pot reached the member whose turn it is
  payoutId: string | null;
  // D63: her answer once the pot reached her: received, or not received.
  receipt: "CONFIRMED" | "DISPUTED" | null;
};

// One member's payment in a round. Every member of the group sees every
// payment (F8): the shared record is what makes the group trust itself.
export type RoundPayment = {
  memberId: string;
  displayName: string;
  status: ContributionStatus | "UNPAID";
  paidAt: string | null;
};

export type RoundDetail = RoundSummary & { payments: RoundPayment[] };

// One line of the group's ledger, which is never edited (D5).
export type LedgerLine = {
  id: string;
  type: "CONTRIBUTION" | "PAYOUT" | "CORRECTION";
  amountFcfa: number;
  roundNumber: number | null;
  memberName: string | null;
  createdAt: string;
};
