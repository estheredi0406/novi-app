import type { PayoutStatus } from "./money.js";

// What an MFI officer sees in the console (Sprint 5). Totals only: never which
// member paid what, nor members' names (D33). A pot's receiver is shown by
// her turn in the order, not by name.

// One group whose money this MFI holds.
export type ConsoleGroup = {
  id: string;
  name: string;
  state: "STARTING" | "ACTIVE" | "COMPLETED";
  accountRef: string | null; // the MFI's own account for the group
  amountFcfa: number; // each member's contribution
  frequency: "WEEKLY" | "MONTHLY";
  size: number;
  startedAt: string | null;
  currentRound: number | null;
  rounds: number;
  collectedFcfa: number; // every contribution received, from Novi's ledger
  paidOutFcfa: number; // every pot sent
  balanceFcfa: number; // what the account should hold: collected minus paid out
  needsAttention: number; // held or failed payouts in this group
  reserveFcfa: number; // D68: the solidarity reserve inside that balance
};

export type ConsoleRound = {
  number: number;
  dueDate: string;
  expectedFcfa: number; // contribution x members
  collectedFcfa: number;
  paymentsReceived: number;
  paymentsExpected: number;
  receiverTurn: number; // which turn in the payout order: the same as the round number
  payout: {
    status: PayoutStatus;
    amountFcfa: number;
    heldSince: string | null;
    paidAt: string | null;
    mfiRef: string | null;
  } | null;
};

export type ConsoleGroupDetail = ConsoleGroup & { roundList: ConsoleRound[] };

// A payout the officer should look at: ready to release (D63), held (not
// full on its due date, D48), failed (the transfer was refused, D49), or
// disputed (the member says the money did not arrive, D63).
export type AttentionItem = {
  payoutId: string;
  groupId: string;
  groupName: string;
  roundNumber: number;
  dueDate: string;
  status: "READY" | "HELD" | "FAILED" | "DISPUTED";
  amountFcfa: number; // what the pot holds so far
  paymentsMissing: number; // how many, never who (D53)
  since: string; // when it was held, or when the transfer was asked
  canRetry: boolean; // only a failed transfer can be retried by the officer
  canRelease: boolean; // only a full, due pot can be released (D63)
  receiverTurn: number; // whose turn: her place in the order, never her name (D33)
};

export type ConsoleOverview = {
  mfiName: string;
  activeGroups: number;
  completedGroups: number;
  balanceFcfa: number; // across every group at this MFI
  held: number;
  failed: number;
  ready: number; // pots waiting for the officer's release (D63)
  disputed: number; // members who said the money did not arrive (D63)
};

// A savings record a member shared with this MFI by name (D54).
export type ConsoleSharedRecord = {
  shareId: string;
  legalName: string;
  issuedAt: string;
  expiresAt: string;
  views: number; // by anyone at this MFI
};

// D67: the MFI's view of its Novi portfolio over time. Totals only (D33).
export type ConsoleAnalytics = {
  weeks: { weekOf: string; collectedFcfa: number; paidOutFcfa: number; payments: number; onTime: number }[];
  members: number; // different people with a seat in a started group
  groups: { starting: number; active: number; completed: number; cancelled: number };
  onTimeRate: number | null; // % of payments made on or before their due date
  potsPaid: number;
  potsDisputed: number; // receivers who said the money did not arrive (D63)
  receiptConfirmedRate: number | null; // % of answered receipts that confirmed
  medianReleaseHours: number | null; // how long a due pot waited for the officer (D63)
  solidarityFundFcfa: number; // D68: the MFI's solidarity fund across all its groups
  coversOpenFcfa: number; // D68: shares the fund paid and members have not repaid yet
  // One line per started group, to compare them. Still no member's name.
  byGroup: {
    groupId: string;
    name: string;
    state: "STARTING" | "ACTIVE" | "COMPLETED";
    members: number;
    collectedFcfa: number;
    onTimeRate: number | null;
    roundsPaidOut: number;
    rounds: number;
    disputed: number;
  }[];
};

// D67: one action by one of this MFI's officers.
export type ConsoleActivity = {
  at: string;
  staffName: string;
  action:
    | "STAFF_GROUP_APPROVED"
    | "STAFF_GROUP_DECLINED"
    | "STAFF_PAYOUT_RELEASED"
    | "STAFF_PAYOUT_RETRY"
    | "STAFF_RECORD_OPENED"
    | "STAFF_MEMBER_LOOKUP"
    | "STAFF_MEMBER_EXIT"
    | "STAFF_PHONE_CHANGED"
    | "STAFF_ORGANISER_CHANGED"
    | "STAFF_ADDED"
    | "STAFF_DEACTIVATED"
    | "STAFF_REACTIVATED"
    | "STAFF_ACCESS_RESET"
    | "STAFF_DEMO_DUE";
  detail: string | null; // the round, the decline reason, or whose record was opened
};

// D69: one member as an officer sees her at the counter, found by her phone
// number. Only for acting on her request, or on a death certificate; every
// lookup is logged with the officer's name.
export type ConsoleMemberSeat = {
  groupId: string;
  groupName: string;
  groupState: "STARTING" | "ACTIVE" | "COMPLETED";
  role: "ORGANISER" | "MEMBER";
  payoutPosition: number | null;
  potReceived: boolean; // her turn has come and the pot was paid
  exitReason: "DEATH" | "LEFT" | null;
  exitedAt: string | null;
  exitPayoutPhone: string | null;
};

export type ConsoleMember = {
  userId: string;
  legalName: string;
  phone: string;
  closed: boolean; // recorded deceased
  nextOfKin: { name: string; phone: string; relation: string } | null;
  owedFcfa: number; // covers the fund paid for her, not repaid nor written off
  seats: ConsoleMemberSeat[];
};
