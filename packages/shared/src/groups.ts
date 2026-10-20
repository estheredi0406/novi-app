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
  size: number;
  seatsHeld: number;
  myRole: MemberRole;
  mySeatState: SeatState;
};