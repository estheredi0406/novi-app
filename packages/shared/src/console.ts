import type { PayoutStatus } from "./money.js";

// What an MFI officer sees in the console. Totals only: never which
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
  // D116: how the group is doing, for the officer's lists.
  health: "RED" | "AMBER" | "GREEN" | null; // null: not running (to validate, or completed)
  watch: GroupWatch | null; // the main reason for the colour, if not green
  onTimePct: number | null; // payments made by the end of their due day, in rounds already due
  nextPotDate: string | null; // the next pot still to leave
};

// D116: why a group is not green, most serious first. Each comes with the
// number involved and, when there is one, a date.
export type GroupWatch = {
  reason:
    | "DEFAULT" // a member missed two repayment deadlines (D104)
    | "TRANSFER_FAILED" // a pot refused after its automatic tries (D114)
    | "DISPUTED" // a member says her pot did not arrive
    | "REPORTED" // a payment still unexplained after the automatic checks (D114)
    | "HELD" // a pot due but not full (D48)
    | "RETRYING" // a refused pot Novi will try again by itself (D114)
    | "COVERED"; // shares the group's advances paid, still to repay (D104)
  count: number;
  date: string | null; // COVERED: the earliest repayment deadline
};

// D116: the "Aujourd'hui" page's figures, for today (GMT, Lomé's time).
export type ConsoleToday = {
  receivedFcfa: number;
  payments: number;
  potsSent: number; // pots that reached their member today
  potsSentFcfa: number;
  potsDueLeft: number; // D150: pots due today not sent yet
  // D150: the tontines running now, their members, and groups to validate.
  activeGroups: number;
  activeMembers: number;
  toValidate: number;
  tontinesFcfa: number; // D150: what the MFI holds for the groups (was "savings", which it is not)
  advancesFcfa: number; // of which the members' advances (D103)
  booksGapFcfa: number; // D150: Novi's ledger minus the MFI's books; 0 when they agree
  // What Novi settled by itself today (D105, D114).
  auto: {
    lateConfirmed: number; // payments credited by an automatic check
    reportsCleared: number; // of which payments a member had reported
    potsAutoReleased: number; // pots under the MFI's limit, sent with no officer
    transfersRetried: number; // pots that went through on a later try
  };
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
    // D117: how it left and whether she confirmed it.
    auto: boolean; // under the MFI's limit, with no officer (D105)
    via: string | null; // fedapay or mfi (D102)
    receipt: "CONFIRMED" | "DISPUTED" | null;
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
  phone: string | null; // to call her before validating
  lastPaidAt: string | null;
  otherActiveGroups: number; // tontines she pays into elsewhere on Novi now
  skipsUsed: number; // rounds the group's advances paid for her, ever
  missedTurns: number; // of those, repaid after the deadline or never
};

export type ConsoleGroupDetail = ConsoleGroup & {
  roundList: ConsoleRound[];
  members: ConsoleMemberCard[];
  // D117: the group page. Members appear by their turn, never by
  // name (D33); names are only in the compliance view.
  payoutOrder: string; // DRAWN or FIXED
  advancesInFcfa: number; // of collectedFcfa, the members' advances (D103)
  mfiOnTimePct: number | null; // the average of this MFI's groups, to compare
  seats: ConsoleSeat[];
  shownRound: ConsoleRoundPayments | null; // the current round, or the last one
  history: { at: string; event: string; by: string | null; round: number | null }[];
};

// D117: one seat of the group, by turn.
export type ConsoleSeat = {
  turn: number;
  organiser: boolean;
  advanceFcfa: number; // her advance, paid with round 1 (D103)
  paidOnTime: number; // of `roundsDue`
  roundsDue: number;
  paid: number; // all her payments in rounds already due, on time or late
  owedFcfa: number; // shares the advances covered for her, not repaid yet (D104)
  owedBy: string | null;
  reported: boolean; // a payment she says left her account, not confirmed (D114)
  defaulted: boolean;
  left: boolean; // she left the group (D69)
  pot: { status: PayoutStatus | "NOT_DUE"; date: string; receipt: "CONFIRMED" | "DISPUTED" | null };
  // D149: at the end of the cycle, her part of the advances given back; null
  // before the end, or when nothing comes back to her (she still owed).
  advanceBack: { amountFcfa: number; status: PayoutStatus } | null;
};

// D117: the payments of one round, without names (D33).
export type ConsoleRoundPayments = {
  number: number;
  dueDate: string;
  payments: {
    at: string;
    operator: string;
    amountFcfa: number;
    status: "PAID" | "PENDING" | "FAILED";
    reported: boolean;
    providerRef: string | null;
  }[];
  coveredFcfa: number[]; // each share the advances paid in this round
  pot: {
    amountFcfa: number;
    status: PayoutStatus;
    at: string | null;
    auto: boolean; // left under the MFI's limit, with no officer (D105)
    via: string | null; // fedapay or mfi (D102)
    ref: string | null;
    receipt: "CONFIRMED" | "DISPUTED" | null;
  } | null;
  expectedFcfa: number; // the full pot this round should reach
};

// D117: the compliance view: names, for anti-money-laundering
// checks, opened by an administrator or a compliance officer with a reason,
// logged, and closed after 15 minutes.
export type ConsoleCompliance = {
  openedAt: string;
  closesAt: string;
  reason: string;
  members: {
    turn: number | null;
    organiser: boolean;
    legalName: string;
    identityVerifiedAt: string;
    phone: string;
    channel: "APP" | "USSD";
    recordShared: boolean | null; // D84: agreed to share her record; null: not asked
    left: boolean;
  }[];
  rounds: {
    number: number;
    dueDate: string;
    payments: {
      at: string;
      legalName: string;
      turn: number | null;
      operator: string;
      amountFcfa: number;
      status: "PAID" | "PENDING" | "FAILED";
      reported: boolean;
      providerRef: string | null;
    }[];
    covered: { legalName: string; amountFcfa: number }[];
  }[];
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
  herKeepFcfa: number | null; // D144: what she chose to keep in savings from this pot; null: she has not chosen (all to her phone)
  savingsToOpenFcfa: number; // D141: she keeps this much in savings and her account is not open yet: the pot waits
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
  autoReleaseChosen: boolean; // D134: false until the MFI has chosen its ceiling (or chosen none)
  savingsTermsComplete: boolean; // D147: false until the caisse has set all its savings conditions
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
    | "STAFF_MISMATCH_RESOLVED"
    | "STAFF_SAVINGS_OPENED"
    | "STAFF_SAVINGS_REFUSED"
    | "STAFF_SAVINGS_POLICY_CHANGED"
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
    | "STAFF_PAYOUTS_ROUTE_SET"
    | "STAFF_COMPLIANCE_OPENED" // D117
    | "STAFF_COMPLIANCE_CLOSED";
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
  // D150: live false = a FedaPay test (sandbox) account: its money is not real.
  fedapay: { source: "mfi" | "demo"; live: boolean; amountFcfa: number | null; checkedAt: string | null } | null;
  inTransitFcfa: number; // pots sent, not yet confirmed
};

// D124: the "Comptes" page. Where the money is, today's movements with where
// each one is now, and what needs a person.
export type ConsoleMoneyWhere = "GROUP_ACCOUNT" | "WAITING" | "REPORTED" | "MISMATCH" | "FAILED" | "SENDING" | "SENT";
export type ConsoleMoney = ConsoleAccounts & {
  savingsFcfa: number; // members' placed savings (D123)
  owedFcfa: number; // what the MFI owes: the groups (Novi's ledger) plus the savings
  today: {
    at: string;
    kind: "CONTRIBUTION" | "PAYOUT" | "SAVINGS_WITHDRAWAL";
    groupId: string | null;
    groupName: string; // a savings withdrawal: the savings account's reference
    round: number | null;
    seat: number | null; // the seat by its turn to receive (D117), never a name
    amountFcfa: number; // + in, - out
    keptFcfa?: number; // a pot: the part placed in savings (D123)
    ref: string | null; // FedaPay's reference
    where: ConsoleMoneyWhere;
    simulated?: boolean; // D150: a pot sent by the stand-in, not by FedaPay
  }[];
  toCheck: {
    contributionId: string;
    at: string;
    groupId: string;
    groupName: string;
    round: number;
    seat: number | null;
    expectedFcfa: number;
    receivedFcfa: number;
    ref: string | null;
    paidNow: boolean; // credited since, after all (a later, correct confirmation)
  }[];
};

export type ConsoleGroupAccount = {
  ref: string;
  balanceFcfa: number;
  // D150: occurredAt is when the money moved; bookedAt, when the books wrote it.
  entries: { occurredAt: string; bookedAt: string; label: string; amountFcfa: number; balanceAfterFcfa: number }[];
};
