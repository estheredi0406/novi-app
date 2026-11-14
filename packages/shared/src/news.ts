// D92: what home and the bell show, across all her groups, and her statement.

// One thing that happened in one of her groups, newest first on home.
export type NewsItem = {
  id: string;
  groupId: string;
  groupName: string;
  event: "PAID" | "POT_PAID" | "TURN_SWAPPED" | "MEETING_SCHEDULED" | "CALL_STARTED" | "NOTICE";
  who: string | null; // the member it is about, as her group sees her
  mine: boolean; // it is about her: her payment, her pot
  round: number | null;
  amountFcfa: number | null; // PAID: one contribution; POT_PAID: the pot
  meetingStartsAt: string | null; // MEETING_SCHEDULED only
  createdAt: string; // ISO
  // D157: NOTICE only: a notification Novi sent her, with the screen it opens.
  notice: { title: string; body: string; url: string; read: boolean } | null;
};

// One line of her statement: a payment she made, or a pot she received.
// One line of her own transactions ("Mes transactions"), newest first.
// PAID: a contribution; ADVANCE: her advance paid with round 1 (D103);
// RECEIVED: a pot; ADVANCE_BACK: her advance given back at the end;
// PENDING: sent, the operator has not confirmed yet; FAILED: not confirmed,
// she can say the money left her account or pay again; COVERED: the group's
// advances paid her share (D104), to repay before dueBy. No money moved for
// COVERED, so it is in neither column of the table.
export type StatementLine = {
  id: string;
  kind: "PAID" | "ADVANCE" | "RECEIVED" | "ADVANCE_BACK" | "PENDING" | "FAILED" | "COVERED";
  groupId: string;
  groupName: string;
  round: number;
  amountFcfa: number;
  at: string; // ISO: when the money moved (or was asked, or covered)
  onTime: boolean | null; // PAID only: on or before the round's due date
  advanceFcfa?: number; // PAID only: her advance paid with it (round 1, D103), included in amountFcfa (D118)
  dueBy?: string | null; // COVERED: repay before this
  repaid?: boolean; // COVERED: already repaid
  reported?: boolean; // FAILED: she said the money left her account
};

export type Statement = {
  lines: StatementLine[]; // newest first
};
