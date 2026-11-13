// D123: her savings at the MFI, kept from her pots.

export type SavingsPocketName = "FREE" | "LOCKED";

export type SavingsRates = {
  freeBp: number | null; // yearly rate in basis points (450 = 4.5 %); null: not set by the MFI
  lock3Bp: number | null;
  lock6Bp: number | null;
  lock12Bp: number | null;
};

// D147: the caisse's savings conditions, as the member reads them before she
// places anything. Only durations the caisse offers are listed.
export type SavingsTerms = {
  freeBp: number | null; // free savings are not offered in the app (D123)
  locks: { months: 3 | 6 | 12; bp: number }[];
  openingFeeFcfa: number;
  monthlyFeeFcfa: number;
  withdrawalFeeFcfa: number;
  minKeepFcfa: number;
  // What she loses taking a placement back before its date.
  early: { rule: "LOSE_GAINS" | "PENALTY"; penaltyBp: number | null };
};

export type SavingsEntryView = {
  id: string;
  kind: "POT_KEPT" | "WITHDRAWAL";
  pocket: SavingsPocketName;
  amountFcfa: number; // + kept, - withdrawn
  lockMonths: number | null;
  unlockAt: string | null;
  status: "DONE" | "SENDING" | "FAILED";
  early: boolean; // a placement taken back before its date (no interest)
  at: string;
};

export type SavingsAccountView = {
  id: string;
  ref: string;
  mfiName: string;
  status: "REQUESTED" | "OPEN" | "REFUSED";
  refusedReason: string | null;
  freeFcfa: number; // she can withdraw it now
  lockedFcfa: number;
  totalFcfa: number;
  // Her placements still running: what each earns if she waits until its date.
  locked: {
    id: string;
    amountFcfa: number;
    unlockAt: string;
    lockMonths: number;
    rateBp: number | null;
    since: string;
    gainAtEndFcfa: number | null;
  }[];
  interestToDateFcfa: number; // an estimate; the MFI credits interest by its own rules
  interestThisMonthFcfa: number;
  entries: SavingsEntryView[];
};

// A pot of hers that she can still direct. D147: from the day she joins the
// group until the pot leaves; before the group starts there is no round yet
// (roundId, roundNumber and dueDate are null).
export type PotChoiceView = {
  roundId: string | null;
  groupId: string;
  groupName: string;
  roundNumber: number | null;
  dueDate: string | null;
  started: boolean; // false: the group has not started yet
  potFcfa: number;
  mfiName: string;
  accountStatus: "REQUESTED" | "OPEN" | "REFUSED" | null; // null: no account yet
  // D144: false until she has answered; "all on my phone" is an answer
  // (keepFcfa 0), not the same as no answer.
  chosen: boolean;
  keepFcfa: number;
  pocket: SavingsPocketName;
  lockMonths: number | null;
  rates: SavingsRates;
  terms: SavingsTerms; // D147: only pots at a caisse with complete conditions are listed
};

export type MySavings = {
  accounts: SavingsAccountView[];
  choices: PotChoiceView[];
};

// D147: every field is required before the caisse can validate a group; a
// lock rate left null means the caisse does not offer that duration.
export type ConsoleSavingsPolicy = SavingsRates & {
  requireForLoan: boolean;
  openingFeeFcfa: number | null;
  monthlyFeeFcfa: number | null;
  withdrawalFeeFcfa: number | null;
  minKeepFcfa: number | null;
  earlyRule: "LOSE_GAINS" | "PENALTY" | null;
  earlyPenaltyBp: number | null;
  complete: boolean; // read only: the conditions are complete
};

export type ConsoleSavings = {
  totalFcfa: number;
  openAccounts: number;
  keptThisMonthFcfa: number;
  withdrawnThisMonthFcfa: number;
  // Accounts she asked for: what she agreed to share, and the day of her pot.
  requests: {
    id: string;
    ref: string;
    legalName: string;
    phone: string;
    idVerifiedAt: string;
    requestedAt: string;
    potDate: string | null;
    keepFcfa: number | null; // what she asked to place from that pot
    lockMonths: number | null;
  }[];
  accounts: {
    id: string;
    ref: string;
    // D155: her account at this MFI: the MFI knows its holder, with what she
    // agreed to share when she asked for it (D33).
    legalName: string;
    phone: string;
    idVerifiedAt: string;
    openedAt: string | null;
    totalFcfa: number;
    lockedFcfa: number;
    interestToDateFcfa: number;
    lastKind: "POT_KEPT" | "WITHDRAWAL" | null;
    lastAmountFcfa: number | null;
    lastAt: string | null;
    sending: boolean;
  }[];
  // The latest withdrawals: sent by Novi on their own, like pots; the officer
  // acts only when one failed (the money then stays in her savings).
  withdrawals: {
    ref: string;
    amountFcfa: number;
    early: boolean;
    status: "DONE" | "SENDING" | "FAILED";
    at: string;
  }[];
  policy: ConsoleSavingsPolicy;
};
