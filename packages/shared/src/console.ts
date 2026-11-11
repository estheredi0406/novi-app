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
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  size: number;
  startedAt: string | null;
  currentRound: number | null;
  rounds: number;
  collectedFcfa: number; // every contribution received, from Novi's ledger
  paidOutFcfa: number; // every pot sent
  potsPaid: number; // D92: how many rounds' pots have left, of `rounds`
  balanceFcfa: number; // what the account should hold: collected minus paid out
  needsAttention: number; // pots held, failed, ready to release or disputed in this group
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

// D84: what the officer sees of each member before validating a group, only
// for members who agreed when joining. Never her payments one by one, nor
// her messages: her name, and the summary of her Novi record.
export type ConsoleMemberCard = {
  turn: number | null; // her place in the payout order, once the group has one
  organiser: boolean;
  consent: boolean;
  name: string | null; // null when she has not agreed
  verifiedAt: string | null; // her identity check (every account has one)
  memberSince: string | null;
  cyclesCompleted: number; // tontines she finished on Novi
  paymentsMade: number;
  paymentsOnTime: number;
  owesCaisseFcfa: number; // rounds the caisse paid for her, not yet repaid
};

export type ConsoleGroupDetail = ConsoleGroup & {
  roundList: ConsoleRound[];
  members: ConsoleMemberCard[];
};

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
  canRelease: boolean; // only a full, due pot can be released (D63), not twice by the same officer (D105)
  needsTwo: boolean; // D105: above the MFI's limit, two officers approve
  firstApprovedBy: string | null; // D105: the officer who gave the first approval
  receiverTurn: number; // whose turn: her place in the order, never her name (D33)
  attempts: number; // D114: transfers tried so far
  nextRetryAt: string | null; // D114: Novi tries again by itself then; null: the officer decides
  receiptCheck: "PAID" | "SENT" | "FAILED" | "UNKNOWN" | null; // D114: the sender asked again after "not received"
  sentTo: string | null; // D114: the number the pot was sent to, for a "not received"
  transferRef: string | null; // the sender's reference for the transfer
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
  reported: number; // D105: payments a member says left her account, to check
  autoReleaseFcfa: number | null; // D105: pots up to this leave without an officer; null: off
};

// D102: the MFI's own FedaPay account, as the console shows it. The keys
// themselves never leave the server once saved.
export type ConsolePaymentAccount = {
  connected: boolean;
  live: boolean;
  connectedAt: string | null;
  payoutsViaFedapay: boolean;
  usesDemo: boolean;
  webhookPath: string;
};

// D105: a payment the operator did not confirm, which the member says left
// her account. The officer checks it against the operator's statement.
export type ConsoleReported = {
  contributionId: string;
  groupId: string;
  groupName: string;
  roundNumber: number;
  memberName: string;
  phone: string; // the number that paid, to find on the statement
  operator: string;
  amountFcfa: number;
  providerRef: string | null;
  requestedAt: string | null;
  reportedAt: string;
  autoChecks: number; // D114: how many times Novi asked the operator again by itself
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
  weeks: {
    weekOf: string;
    collectedFcfa: number;
    paidOutFcfa: number;
    payments: number;
    onTime: number;
  }[];
  members: number; // different people with a seat in a started group
  groups: {
    starting: number;
    active: number;
    completed: number;
    cancelled: number;
  };
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
    | "STAFF_ADVANCE_SENT"
    | "STAFF_RECORD_OPENED"
    | "STAFF_MEMBER_LOOKUP"
    | "STAFF_MEMBER_EXIT"
    | "STAFF_PHONE_CHANGED"
    | "STAFF_ORGANISER_CHANGED"
    | "STAFF_ADDED"
    | "STAFF_DEACTIVATED"
    | "STAFF_REACTIVATED"
    | "STAFF_ACCESS_RESET"
    | "STAFF_DEMO_DUE"
    | "STAFF_CREDIT_POLICY_CHANGED"
    | "STAFF_LOAN_PRESELECT"
    | "STAFF_LOAN_DECLINE"
    | "STAFF_LOAN_GRANT"
    | "STAFF_LOAN_NOTGRANTED"
    | "STAFF_LOAN_DOCUMENT_VIEWED"
    | "STAFF_LOAN_DOCUMENT_REVIEWED"
    | "STAFF_PAYOUT_APPROVED" // D105: first of two approvals
    | "STAFF_PAYMENT_FOUND"
    | "STAFF_PAYMENT_NOT_FOUND"
    | "STAFF_AUTO_RELEASE_SET"
    | "STAFF_PAYMENT_ACCOUNT_CONNECTED" // D102
    | "STAFF_PAYMENT_ACCOUNT_DISCONNECTED"
    | "STAFF_PAYOUTS_ROUTE_SET";
  // D92: the Journal's filters.
  category: "MONEY" | "GROUPS" | "CREDIT" | "MEMBERS" | "TEAM";
  subject: string | null; // the group, the member or the officer it is about
  round: number | null;
  amountFcfa: number | null;
  // The decline reason, the document (ID_CARD...), "ACCEPTED"/"REDO" for a
  // reviewed document, or the exit reason.
  detail: string | null;
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

// D113: the money seen three ways, for the MFI. Novi's ledger, the MFI's own
// books (simulated core banking in the pilot), and the real FedaPay balance.
export type ConsoleAccounts = {
  noviFcfa: number; // what the groups should hold, by Novi's ledger
  bankFcfa: number; // what the MFI's books hold for them
  bankAccounts: number;
  fedapay: { source: "mfi" | "demo"; amountFcfa: number | null; checkedAt: string | null } | null;
  inTransitFcfa: number; // pots sent, not yet confirmed
};

export type ConsoleGroupAccount = {
  ref: string;
  balanceFcfa: number;
  entries: { bookedAt: string; label: string; amountFcfa: number; balanceAfterFcfa: number }[];
};
