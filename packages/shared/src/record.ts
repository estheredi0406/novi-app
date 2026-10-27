// Her savings record (the ACEV, Sprint 6): facts about how she has saved,
// never a score (brief). Amounts in whole FCFA (D4), dates "YYYY-MM-DD".

// One group she has saved in.
export type RecordGroup = {
  name: string;
  mfiName: string; // the institution that held this group's money
  amountFcfa: number;
  frequency: "WEEKLY" | "MONTHLY";
  completed: boolean; // every member received the pot (D27)
  roundsDue: number; // rounds whose due date has passed
  paid: number;
  onTime: number;
};

export type SavingsRecord = {
  legalName: string; // the name on her ID (D15): a lender must know whose record it is
  memberSince: string;
  asOf: string;
  groupsJoined: number;
  groupsCompleted: number;
  paymentsMade: number;
  paidOnTime: number; // paid on or before the due date
  paidLate: number;
  missed: number; // due date passed, still not paid
  totalSavedFcfa: number;
  potsReceived: number;
  totalReceivedFcfa: number;
  groups: RecordGroup[];
  // Added 26 Oct (D65); absent from records shared before then.
  onTimeRate?: number; // paid on time, as a whole percentage of payments made
  potsConfirmed?: number; // pots whose receiver said "I received it" (D63)
  identityCheckedBy?: string; // who confirmed her identity: "ANID"
  ledgerLines?: number; // her lines in Novi's ledger, up to asOf
  // SHA-256 of those lines, in order: any later change to one of them no
  // longer matches this fingerprint (D65).
  ledgerFingerprint?: string;
};

// An institution she can share her record with by name (D54).
export type Lender = { code: string; name: string };

// A signed snapshot she shared with a lender (D50).
export type RecordShareView = {
  id: string; // also the code in the QR
  sharedWith: Lender | null; // one MFI only (D54), or null for a code any lender can open
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  views: number;
  lastViewedAt: string | null;
};

// What a lender sees when checking a shared record.
export type RecordVerification = {
  // PRIVATE: shared with one MFI only, and this viewer is not its staff (D54).
  status: "VALID" | "EXPIRED" | "REVOKED" | "TAMPERED" | "PRIVATE";
  sharedWith: string | null; // the MFI's name, for a record shared with one
  issuer: "Novi";
  issuedAt: string;
  expiresAt: string;
  record: SavingsRecord | null; // shown only while VALID
};
