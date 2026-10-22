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
};

// A signed snapshot she shared with a lender (D50).
export type RecordShareView = {
  id: string; // also the code in the QR
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  views: number;
  lastViewedAt: string | null;
};

// What a lender sees when checking a shared record.
export type RecordVerification = {
  status: "VALID" | "EXPIRED" | "REVOKED" | "TAMPERED";
  issuer: "Novi";
  issuedAt: string;
  expiresAt: string;
  record: SavingsRecord | null; // shown only while VALID
};
