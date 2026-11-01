// D92: what home and the bell show, across all her groups, and her statement.

// One thing that happened in one of her groups, newest first on home.
export type NewsItem = {
  id: string;
  groupId: string;
  groupName: string;
  event: "PAID" | "POT_PAID" | "TURN_SWAPPED" | "MEETING_SCHEDULED" | "CALL_STARTED";
  who: string | null; // the member it is about, as her group sees her
  mine: boolean; // it is about her: her payment, her pot
  round: number | null;
  amountFcfa: number | null; // PAID: one contribution; POT_PAID: the pot
  meetingStartsAt: string | null; // MEETING_SCHEDULED only
  createdAt: string; // ISO
};

// One line of her statement: a payment she made, or a pot she received.
export type StatementLine = {
  id: string;
  kind: "PAID" | "RECEIVED";
  groupName: string;
  round: number;
  amountFcfa: number;
  at: string; // ISO: when the money moved
  onTime: boolean | null; // PAID only: on or before the round's due date
};

export type Statement = {
  lines: StatementLine[]; // newest first
};
