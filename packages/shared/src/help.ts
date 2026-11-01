// Help inside the group (D87, D88) and microloans from the MFI (D89).

// D87: two members swap their turns to receive the pot.
export type TurnSwapView = {
  id: string;
  requesterName: string;
  partnerName: string;
  requesterRound: number;
  partnerRound: number;
  status: "ASKED" | "AGREED" | "DONE" | "DECLINED" | "CANCELLED";
  mine: boolean; // she asked for it
  canAnswer: boolean; // she is the partner and it waits for her
  canConfirm: boolean; // she is the organiser and both members agreed
  canCancel: boolean; // she asked for it and it is still open
  createdAt: string;
};

// D88: a small advance from the solidarity fund, repaid from her pot.
export type AdvanceView = {
  id: string;
  borrowerName: string;
  mine: boolean;
  amountFcfa: number;
  reason: string | null;
  status:
    | "ASKED"
    | "APPROVED"
    | "SENT"
    | "PAID"
    | "REPAID"
    | "DECLINED"
    | "CANCELLED";
  approvals: number; // of the two needed
  canApprove: boolean; // she may approve or decline it now
  canCancel: boolean;
  createdAt: string;
};

// What the "Entraide" part of the group page shows.
export type GroupHelp = {
  swaps: TurnSwapView[]; // open ones, and those decided in the last 30 days
  advances: AdvanceView[];
  // Whether she may ask, and up to how much (one contribution).
  canSwap: boolean;
  canAskAdvance: boolean;
  advanceMaxFcfa: number; // one contribution, or less if the fund holds less
  fundTooLow: boolean; // she could ask, but the solidarity fund cannot spare 500 F now
  // The members she could swap with: their turn has not been paid out yet.
  swapPartners: {
    memberId: string;
    name: string;
    round: number;
    dueDate: string;
  }[];
  myRound: number | null;
};

export type LoanPurpose = "STOCK" | "EQUIPMENT" | "OTHER";
export type LoanStatus = "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN";

export type LoanCheck = {
  key:
    | "CYCLE_OR_STREAK"
    | "ON_TIME"
    | "NO_DEBT"
    | "NO_OPEN_REQUEST"
    | "WAIT_AFTER_REFUSAL";
  ok: boolean;
};

export type LoanRequestView = {
  id: string;
  amountFcfa: number;
  purpose: LoanPurpose;
  months: number;
  status: LoanStatus;
  grantedFcfa: number | null;
  decisionNote: string | null;
  mfiName: string;
  createdAt: string;
  decidedAt: string | null;
};

// D89: what the app shows on "Crédit FUCEC".
export type LoanPage = {
  eligible: boolean;
  checks: LoanCheck[];
  ceilingFcfa: number; // 3 x her largest pot
  mfiName: string | null; // the MFI holding her groups, which she would ask
  onTimePercent: number | null;
  requests: LoanRequestView[];
};

// The officer's list and detail (console).
export type ConsoleLoan = {
  id: string;
  memberName: string;
  groupNames: string[];
  amountFcfa: number;
  purpose: LoanPurpose;
  months: number;
  status: LoanStatus;
  grantedFcfa: number | null;
  createdAt: string;
  decidedAt: string | null;
  ceilingFcfa: number;
};

export type ConsoleLoanDetail = ConsoleLoan & {
  decisionNote: string | null;
  phone: string;
  area: string;
  market: string | null;
  verifiedAt: string;
  memberSince: string;
  cyclesCompleted: number;
  paymentsMade: number;
  paymentsOnTime: number;
  owesFcfa: number;
  groups: {
    name: string;
    state: string;
    amountFcfa: number;
    paid: number;
    onTime: number;
    rounds: number;
  }[];
};

// D88: approved advances the officer sends from the fund.
export type ConsoleAdvance = {
  id: string;
  groupId: string;
  groupName: string;
  amountFcfa: number;
  status: "APPROVED" | "SENT" | "PAID" | "REPAID";
  approvedAt: string;
  receiverTurn: number | null; // her place, never her name (D33)
};
