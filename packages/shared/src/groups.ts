import type { PayoutStatus } from "./money.js";
// What the app receives about savings groups. The values of each list match
// the API's database, so a new state added there must be added here too.

export type GroupState = "DRAFT" | "PROPOSED" | "STARTING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export type Frequency = "WEEKLY" | "MONTHLY";
export type PayoutOrder = "DRAWN" | "FIXED";
export type MemberRole = "ORGANISER" | "MEMBER";
export type SeatState = "INVITED" | "ACCEPTED" | "COUNTERED" | "DECLINED" | "REMOVED";

// One version of a group's rules (D29).
export type GroupRules = {
  version: number;
  amountFcfa: number; // whole FCFA (D4)
  frequency: Frequency;
  dueDay: number; // WEEKLY: 1 (Monday) to 7 (Sunday); MONTHLY: 1 to 28
  size: number;
  payoutOrder: PayoutOrder;
  fixedOrder: string[]; // FIXED only: member IDs, first to be paid first (D41)
};

// One seat as every member of the group sees it. Only the display name is
// shown, never the legal name or phone number (D15).
export type GroupSeat = {
  memberId: string;
  displayName: string;
  role: MemberRole;
  state: SeatState;
  acceptedCurrentRules: boolean;
  counterNote: string | null;
  payoutPosition: number | null; // her turn, 1 = paid first; set when the group starts
  maskedPhone: string | null; // organiser only: "+228 90 •• •• 56", to check the right person joined (D43)
  exitReason: "DEATH" | "LEFT" | null; // D69: she left the started group early
};

// An invitation not answered yet, as the group sees it. Only part of the
// number is shown, the same way whether or not it has a Novi account (D38).
export type PendingInvite = {
  id: string;
  maskedPhone: string; // "+228 90 •• •• 56"
};

// A group, as shown on its own page.
export type GroupDetail = {
  id: string;
  name: string;
  state: GroupState;
  mfiName: string; // every money screen names the MFI holding the money
  rules: GroupRules;
  seats: GroupSeat[];
  pendingInvites: PendingInvite[];
  myRole: MemberRole;
  // D68: the group's solidarity reserve, once it has started.
  // balanceFcfa: what the group has in the MFI's solidarity fund; fundFcfa:
  // the whole fund, across the MFI's groups, which is what can cover a share.
  reserve: { percent: number; balanceFcfa: number; fundFcfa: number; owedFcfa: number; coversOpen: number } | null;
  unreadMessages: number; // D70: chat lines since she last opened the chat
  // D72: which cycle of this circle of members, and the cycles before and after.
  cycleNumber: number;
  previousCycleId: string | null;
  nextCycleId: string | null; // set once the organiser started the next cycle
  // D80: once the cycle is complete, who wants to go again (display names).
  continueAnswers: { yes: string[]; no: string[]; waiting: string[] } | null;
  myContinue: boolean | null; // her own answer, null until she answers
};

// An invitation as the invited person sees it: enough to decide whether to
// join. She sees the group's rules before she has a seat in it.
export type Invitation = {
  id: string;
  groupId: string;
  groupName: string;
  groupState: GroupState;
  organiserName: string;
  mfiName: string;
  rules: GroupRules;
  seatsHeld: number;
};

// A group, as shown in her list of groups.
export type GroupSummary = {
  id: string;
  name: string;
  state: GroupState;
  mfiName: string;
  amountFcfa: number;
  frequency: Frequency;
  dueDay: number;
  size: number;
  seatsHeld: number;
  myRole: MemberRole;
  mySeatState: SeatState;
  currentRound: CurrentRound | null; // only while the group is running
  unreadMessages: number; // D70: chat messages since she last opened it
  cycleNumber: number; // D72
};

// What matters to her this week in a running group: does she still owe her
// contribution, and is it her turn to receive the pot? Shown on home.
export type CurrentRound = {
  number: number;
  dueDate: string; // "YYYY-MM-DD"
  myStatus: "UNPAID" | "PENDING" | "PAID" | "FAILED";
  isMyTurn: boolean;
  potFcfa: number;
  paidCount: number; // how many members have paid this round: the pot filling
  // The round whose pot is hers, and where that pot is: not due yet, held,
  // on its way, or received (PAID).
  myTurn: { number: number; dueDate: string; payoutStatus: PayoutStatus } | null;
  onTimeStreak: number; // her payments on time in a row in this group, up to now
};
// ---------- The group's chat (D70) ----------

// One line of the chat. A TEXT was written by a member; an EVENT was written
// by Novi when money moved, and the app words it in the reader's language.
export type ChatMessage = {
  id: string;
  kind: "TEXT" | "EVENT" | "VOICE";
  authorId: string | null;
  authorName: string | null; // her display name, as her group sees it
  mine: boolean;
  body: string | null; // null when hidden, or for an EVENT
  event: "PAID" | "POT_PAID" | "MEETING_SCHEDULED" | "MEETING_CANCELLED" | "CALL_STARTED" | null;
  round: number | null;
  // D71; state tells a call still open from one that ended
  meeting: { id: string; title: string; startsAt: string; state: MeetingState; instant: boolean } | null;
  voice: { durationMs: number; available: boolean } | null; // VOICE only; false once deleted
  hidden: boolean;
  canHide: boolean; // she wrote it, or she is the organiser
  createdAt: string; // ISO
};

export type VoiceAudio = { mime: string; audioBase64: string };

// "Appeler le groupe": the open call she joins, started now or already running.
export type GroupCall = { meetingId: string; url: string };

export type ChatPage = {
  messages: ChatMessage[]; // oldest first
  hasEarlier: boolean;
  canWrite: boolean; // false once she has left, or the group was cancelled
};

// ---------- Group meetings (D71) ----------

export type MeetingState = "UPCOMING" | "OPEN" | "ENDED" | "CANCELLED";

export type GroupMeetingView = {
  id: string;
  title: string;
  agenda: string | null;
  startsAt: string; // ISO
  endsAt: string; // ISO
  durationMin: number;
  state: MeetingState; // OPEN from 10 minutes before the start until the end
  createdByName: string;
  joined: string[]; // display names of the members who joined
  canCancel: boolean; // the organiser, before it ends
};

export type MeetingsPage = {
  upcoming: GroupMeetingView[]; // soonest first, including one open now
  past: GroupMeetingView[]; // most recent first, the last 30 days
  canSchedule: boolean;
};
