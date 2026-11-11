// What the app receives about money: rounds, payments and the ledger.
// Amounts are whole FCFA (D4). Dates are "YYYY-MM-DD" (Togo uses GMT).

export type MobileOperator = "MOOV_TG" | "TOGOCEL";
export type ContributionStatus = "PENDING" | "PAID" | "FAILED";

// Where a round's pot is (Sprint 4). NOT_DUE: its day has not come yet.
// HELD: the day has passed but someone has not paid; nothing is sent short.
// READY: due and full, waiting for the MFI officer to release it (D63).
export type PayoutStatus =
  "NOT_DUE" | "HELD" | "READY" | "SENDING" | "SENT" | "PAID" | "FAILED";

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
  amountFcfa: number; // what each member pays this round (round 1 adds her advance: advanceFcfa)
  paidCount: number;
  size: number;
  collectedFcfa: number; // paid so far
  potFcfa: number; // what the round collects once everyone has paid
  myStatus: ContributionStatus | "UNPAID";
  // Her latest attempt for this round, if any: a FAILED one can be reported
  // as "the money left my account" (myReported), for the MFI to check.
  myContributionId: string | null;
  myReported: boolean;
  myNextCheckAt: string | null; // D118: when Novi asks the operator again (D114); null when it will not
  // D105: the MFI did not find that payment on the operator's statement; she pays again.
  myReportRejected: boolean;
  payoutStatus: PayoutStatus;
  paidOutAt: string | null; // when the pot reached the member whose turn it is
  payoutId: string | null;
  // D63: her answer once the pot reached her: received, or not received.
  receipt: "CONFIRMED" | "DISPUTED" | null;
  coveredCount: number; // members whose share the group's advances paid this round (D104)
  advanceFcfa: number; // D103: her advance, paid with round 1, on top of the contribution
  // D104: this round's share was covered for her; repay before dueBy.
  myCover: { asked: boolean; dueBy: string | null; repaid: boolean; missed: boolean } | null;
  canSkip: boolean; // "Je ne peux pas payer ce tour" is open to her for this round
};

// One member's payment in a round. Every member of the group sees every
// payment (F8): the shared record is what makes the group trust itself.
export type RoundPayment = {
  memberId: string;
  displayName: string;
  status: ContributionStatus | "UNPAID";
  paidAt: string | null;
  coveredByReserve: boolean; // D68: the reserve paid her share of this pot; she still owes it unless repaid
  coverRepaid: boolean;
};

export type RoundDetail = RoundSummary & { payments: RoundPayment[]; mfiName: string };

// One line of the group's ledger, which is never edited (D5).
export type LedgerLine = {
  id: string;
  type:
    | "CONTRIBUTION"
    | "PAYOUT"
    | "CORRECTION"
    | "RESERVE_IN"
    | "RESERVE_COVER"
    | "RESERVE_REPAY"
    | "RESERVE_RETURN"
    | "RESERVE_ADVANCE"
    | "RESERVE_ADVANCE_REPAY";
  amountFcfa: number;
  roundNumber: number | null;
  memberName: string | null;
  createdAt: string;
};
