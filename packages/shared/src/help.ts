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
  | "PRESELECTED"
  | "GRANTED"
  | "NOT_GRANTED"
  | "DECLINED"
  | "WITHDRAWN";

// Her business, as she declares it with a request: the MFI looks at it first.
export type BusinessKind = "FABRICS" | "FOOD" | "RESTAURANT" | "BEAUTY" | "OTHER";
export type BusinessSince = "UNDER_1Y" | "Y1_TO_3" | "OVER_3Y";
export type LoanBusiness = {
  kind: BusinessKind;
  since: BusinessSince;
  weeklySalesFcfa: number;
  place: string;
};

// One of the MFI's conditions with her own figures, so she and the officer
// see why it is met or not.
export type LoanCheck = {
  key:
    | "CYCLE_OR_STREAK"
    | "ON_TIME"
    | "NO_DEBT"
    | "NO_OPEN_REQUEST"
    | "WAIT_AFTER_REFUSAL"
    | "CEILING"
    | "SAVINGS";
  ok: boolean;
  figures: Record<string, number>;
};

// The MFI's credit conditions, and the documents she brings to the agency.
export type LoanDocumentSpec = { key: string; label: string };
export type CreditPolicyView = {
  enabled: boolean;
  minCycles: number;
  minStreak: number;
  minOnTimePct: number;
  ceilingTimesPot: number;
  waitDays: number;
  documents: LoanDocumentSpec[];
  updatedAt: string | null;
  updatedByName: string | null;
};
export type CreditPolicyInput = Omit<
  CreditPolicyView,
  "updatedAt" | "updatedByName"
>;
export type CreditPolicyPreview = { eligible: number; members: number };

export type LoanRequestView = {
  id: string;
  amountFcfa: number;
  purpose: LoanPurpose;
  business: LoanBusiness | null; // null on requests made before it was asked
  status: LoanStatus;
  grantedFcfa: number | null;
  decisionNote: string | null;
  mfiName: string;
  createdAt: string;
  decidedAt: string | null;
  toBring: string[]; // once preselected: what she brings to sign at the agency
};

export type LoanPage = {
  enabled: boolean;
  eligible: boolean;
  checks: LoanCheck[];
  ceilingFcfa: number;
  documents: LoanDocumentSpec[];
  business: LoanBusiness | null; // her last answers, to start from
  place: string; // where she trades, from sign-up
  mfiName: string | null;
  onTimePercent: number | null;
  onTimeNeeded: number | null;
  requests: LoanRequestView[];
};

export type ConsoleLoan = {
  id: string;
  memberName: string;
  groupNames: string[];
  amountFcfa: number;
  purpose: LoanPurpose;
  business: LoanBusiness | null;
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
  checks: LoanCheck[];
  policyUpdatedAt: string | null;
  toBring: string[];
};
