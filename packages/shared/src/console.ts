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
};

export type ConsoleRound = {
  number: number;
  dueDate: string;
  expectedFcfa: number; // contribution x members
  collectedFcfa: number;
  paymentsReceived: number;
  paymentsExpected: number;
  receiverTurn: number; // which turn in the payout order: the same as the round number
  payout: { status: PayoutStatus; amountFcfa: number; heldSince: string | null; paidAt: string | null; mfiRef: string | null } | null;
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
