// D123: her savings at the MFI, kept from her pots.

export type SavingsPocketName = "FREE" | "LOCKED";

export type SavingsRates = {
  freeBp: number | null; // yearly rate in basis points (450 = 4.5 %); null: not set by the MFI
  lock3Bp: number | null;
  lock6Bp: number | null;
  lock12Bp: number | null;
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

// A pot of hers that she can still direct (from 3 days before it).
export type PotChoiceView = {
  roundId: string;
  groupId: string;
  groupName: string;
  roundNumber: number;
  dueDate: string;
  potFcfa: number;
  mfiName: string;
  accountStatus: "REQUESTED" | "OPEN" | "REFUSED" | null; // null: no account yet
  keepFcfa: number;
  pocket: SavingsPocketName;
  lockMonths: number | null;
  rates: SavingsRates;
};

export type MySavings = {
  accounts: SavingsAccountView[];
  choices: PotChoiceView[];
};

export type ConsoleSavingsPolicy = SavingsRates & { requireForLoan: boolean };

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
