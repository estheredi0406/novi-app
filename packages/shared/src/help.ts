// Help inside the group (D87) and microloans from the MFI (D89).

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

// What the "Entraide" part of the group page shows.
export type GroupHelp = {
  swaps: TurnSwapView[]; // open ones, and those decided in the last 30 days
  canSwap: boolean; // whether she may ask for a swap now
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
export type LoanStatus =
  | "PENDING"
  | "APPROVED"
  | "PRESELECTED"
  | "GRANTED"
  | "NOT_GRANTED"
  | "DECLINED"
  | "WITHDRAWN";

// D91: one of the MFI's conditions, with her own figures so both she and the
// officer see why it is met or not. The app and the console write the
// sentence from the key and the figures.
export type LoanCheck = {
  key:
    | "CYCLE_OR_STREAK"
    | "ON_TIME"
    | "NO_DEBT"
    | "NO_OPEN_REQUEST"
    | "WAIT_AFTER_REFUSAL"
    | "CEILING";
  ok: boolean;
  figures: Record<string, number>;
};

// D91: the MFI's own credit conditions (set by its administrator).
export type LoanDocumentSpec = { key: string; label: string };
export type CreditPolicyView = {
  enabled: boolean;
  minCycles: number;
  minStreak: number;
  minOnTimePct: number;
  ceilingTimesPot: number;
  waitDays: number;
  months: number[];
  documents: LoanDocumentSpec[];
  updatedAt: string | null;
  updatedByName: string | null;
};
export type CreditPolicyInput = Omit<
  CreditPolicyView,
  "updatedAt" | "updatedByName"
>;
export type CreditPolicyPreview = { eligible: number; members: number };

export type LoanDocumentView = {
  key: string;
  label: string;
  status: "MISSING" | "SENT" | "ACCEPTED" | "REDO";
  note: string | null;
  id: string | null; // the photo, for the officer to open
  sentAt: string | null;
  deleted: boolean; // the photo was deleted after the file closed
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
  documents: LoanDocumentView[]; // once preselected
  documentsConsented: boolean;
  documentsComplete: boolean; // every document accepted: she goes to the agency
};

// D89, D91: what the app shows on "Crédit FUCEC".
export type LoanPage = {
  enabled: boolean; // the MFI receives requests
  eligible: boolean;
  checks: LoanCheck[];
  ceilingFcfa: number;
  months: number[];
  mfiName: string | null;
  onTimePercent: number | null;
  onTimeNeeded: number | null; // payments on time still needed to reach the MFI's minimum
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
  documentsSent: number; // photos waiting for the officer's look
  documentsComplete: boolean;
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
  checks: LoanCheck[]; // the MFI's conditions, as they stand today
  policyUpdatedAt: string | null;
  documents: LoanDocumentView[];
  documentsConsented: boolean;
};
