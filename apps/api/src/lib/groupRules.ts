import type { Frequency, GroupState, SeatState } from "../generated/prisma/enums.js";

// Novi's group rules, written as plain functions: no database, no network.
// Each one receives the facts it needs and answers "allowed" or "refused,
// and why". The services in Sprint 2 fetch the facts and act on the answer;
// keeping the rules here means they can be tested on their own, and read as
// one list.

// The limits from the product rules and decisions D26 to D28, D31.
export const LIMITS = {
  minSize: 3, // D28
  maxSize: 15,
  maxActiveGroups: 3, // D26
  startsBeforeCompletedCycle: 2, // D27
  minAmountFcfa: 100, // D31
  maxAmountFcfa: 1_000_000, // D31
} as const;

// Why an action was refused. The API turns each reason into an error code
// and a message key, so the member is told what to change.
export type RuleBreak =
  | "NOT_ALLOWED_NOW" // the group's state does not allow this action
  | "ORGANISER_ONLY"
  | "MEMBERS_ONLY"
  | "SIZE_OUT_OF_RANGE"
  | "AMOUNT_OUT_OF_RANGE"
  | "DUE_DAY_OUT_OF_RANGE"
  | "GROUP_FULL"
  | "GROUP_LIMIT_REACHED"
  | "START_LIMIT_REACHED"
  | "SEATS_NOT_FILLED"
  | "NOT_EVERYONE_ACCEPTED"
  | "RULES_CHANGED" // she answered a version of the rules that is no longer the current one
  | "ORDER_INVALID" // a fixed payout order that does not list every member exactly once
  | "ROUND_NOT_OPEN" // paying a round whose turn has not come yet
  | "ALREADY_PAID"
  | "PAYMENT_IN_PROGRESS"; // a request is already waiting for her confirmation

export type RuleResult = { ok: true } | { ok: false; reason: RuleBreak };

const allowed: RuleResult = { ok: true };
const refused = (reason: RuleBreak): RuleResult => ({ ok: false, reason });

// ---------- What can be done, when, and by whom (D29) ----------

export type GroupAction =
  | "EDIT_RULES" // change amount, frequency, day, size or payout order
  | "INVITE"
  | "REMOVE_SEAT"
  | "PROPOSE" // send the rules to the invited members
  | "RESPOND" // accept the rules, or ask for a change
  | "DECLINE" // say no, or leave before the group starts
  | "SET_ORDER" // choose a fixed payout order (D41)
  | "START"
  | "CANCEL"
  | "PAY"; // pay her contribution for a round (Sprint 3)

type Who = "ORGANISER" | "MEMBER" | "ANYONE";

// The whole state machine in one table. Anything not listed is refused.
// Once a group is STARTING, the only thing a person can do is ask Novi to
// try opening the MFI account again; from then on, only Novi and the MFI
// move it forward.
const WHEN: Record<GroupAction, { states: readonly GroupState[]; by: Who }> = {
  EDIT_RULES: { states: ["DRAFT", "PROPOSED"], by: "ORGANISER" },
  INVITE: { states: ["DRAFT", "PROPOSED"], by: "ORGANISER" },
  REMOVE_SEAT: { states: ["DRAFT", "PROPOSED"], by: "ORGANISER" },
  PROPOSE: { states: ["DRAFT"], by: "ORGANISER" },
  RESPOND: { states: ["PROPOSED"], by: "MEMBER" },
  DECLINE: { states: ["DRAFT", "PROPOSED"], by: "MEMBER" },
  SET_ORDER: { states: ["PROPOSED"], by: "ORGANISER" },
  START: { states: ["PROPOSED", "STARTING"], by: "ORGANISER" },
  CANCEL: { states: ["DRAFT", "PROPOSED"], by: "ORGANISER" },
  PAY: { states: ["ACTIVE"], by: "ANYONE" }, // the organiser pays like everyone else
};

// Is this person allowed to do this action on a group in this state?
export function checkAction(action: GroupAction, state: GroupState, isOrganiser: boolean): RuleResult {
  const rule = WHEN[action];
  if (!rule.states.includes(state)) return refused("NOT_ALLOWED_NOW");
  if (rule.by === "ORGANISER" && !isOrganiser) return refused("ORGANISER_ONLY");
  if (rule.by === "MEMBER" && isOrganiser) return refused("MEMBERS_ONLY");
  return allowed;
}

// ---------- The rules a group proposes ----------

export type ProposedRules = {
  amountFcfa: number;
  frequency: Frequency;
  dueDay: number;
  size: number;
};

// Checks a set of rules before it becomes a version. Amounts are whole FCFA
// (D4); monthly due days stop at 28 so every month has one (D30).
export function checkRules(rules: ProposedRules): RuleResult {
  const { amountFcfa, frequency, dueDay, size } = rules;

  if (!Number.isInteger(size) || size < LIMITS.minSize || size > LIMITS.maxSize) {
    return refused("SIZE_OUT_OF_RANGE");
  }
  if (!Number.isInteger(amountFcfa) || amountFcfa < LIMITS.minAmountFcfa || amountFcfa > LIMITS.maxAmountFcfa) {
    return refused("AMOUNT_OUT_OF_RANGE");
  }
  const lastDay = frequency === "WEEKLY" ? 7 : 28;
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > lastDay) {
    return refused("DUE_DAY_OUT_OF_RANGE");
  }
  return allowed;
}

// She accepts or counters the exact version she read. If the organiser changed
// the rules while she was reading, her answer is refused and she reads the
// new version, so nobody agrees to rules she has not seen (D29).
export function checkAnswersCurrentRules(versionSeen: number, currentVersion: number): RuleResult {
  return versionSeen === currentVersion ? allowed : refused("RULES_CHANGED");
}

// ---------- Seats ----------

export type Seat = { state: SeatState; acceptedVersion: number | null };

// A declined or removed seat is free again; every other seat is held.
export function holdsSeat(seat: Seat): boolean {
  return seat.state !== "DECLINED" && seat.state !== "REMOVED";
}

// The organiser may invite only while a seat is free.
export function checkCanInvite(seats: readonly Seat[], size: number): RuleResult {
  return seats.filter(holdsSeat).length < size ? allowed : refused("GROUP_FULL");
}

// Does this seat count towards the member's 3-group limit? Yes once she has
// accepted, while the group is deciding, starting or running (D26).
export function countsTowardLimit(groupState: GroupState, seat: Seat): boolean {
  const live = groupState === "PROPOSED" || groupState === "STARTING" || groupState === "ACTIVE";
  return live && seat.state === "ACCEPTED";
}

// Checked when she accepts a group's rules: she may hold at most 3 (D26).
// activeGroups is how many of her seats already count towards the limit.
export function checkCanJoin(activeGroups: number): RuleResult {
  return activeGroups < LIMITS.maxActiveGroups ? allowed : refused("GROUP_LIMIT_REACHED");
}

// Checked when an organiser starts a group: 2 starts, then a third only after
// she has belonged to a group that reached COMPLETED (D27).
// groupsStarted counts her groups that reached STARTING, ACTIVE or COMPLETED.
export function checkCanStartAnother(groupsStarted: number, hasCompletedCycle: boolean): RuleResult {
  if (hasCompletedCycle) return allowed;
  return groupsStarted < LIMITS.startsBeforeCompletedCycle ? allowed : refused("START_LIMIT_REACHED");
}

// A group may start only when every seat is filled and every member has
// accepted the version of the rules in force now (D29).
export function checkReadyToStart(seats: readonly Seat[], size: number, currentVersion: number): RuleResult {
  const held = seats.filter(holdsSeat);
  if (held.length !== size) return refused("SEATS_NOT_FILLED");
  const everyoneAgreed = held.every((seat) => seat.state === "ACCEPTED" && seat.acceptedVersion === currentVersion);
  return everyoneAgreed ? allowed : refused("NOT_EVERYONE_ACCEPTED");
}

// A fixed payout order must name every seat holder exactly once, and nobody
// else (D41). It is checked when the organiser sets it, and again at the
// start, because someone may have left or been removed in between.
export function checkFixedOrder(order: readonly string[], seatHolders: readonly string[]): RuleResult {
  const sameLength = order.length === seatHolders.length;
  const everyoneOnce = new Set(order).size === order.length && seatHolders.every((id) => order.includes(id));
  return sameLength && everyoneOnce ? allowed : refused("ORDER_INVALID");
}

// ---------- Paying (Sprint 3) ----------

// A payment request waits this long for her confirmation on her phone before
// she may ask again. Mobile money prompts expire after a few minutes.
export const PAYMENT_WAIT_MS = 5 * 60 * 1000;

export type PaymentAttempt = { status: "PENDING" | "PAID" | "FAILED"; requestedAt: Date };

// May she pay this round now? Rounds up to the current one can be paid,
// late ones included. Once she has paid the current round, she may also pay
// the next one ahead (D83), never further: a trader who has the money today
// can set it aside, but nobody pays a whole cycle in advance.
// One payment per round: a paid round is refused, and a request still
// waiting for her confirmation is not sent twice.
export function checkCanPay(
  roundNumber: number,
  currentRound: number,
  attempt: PaymentAttempt | null,
  now: Date,
  paidCurrent = false,
): RuleResult {
  const earlyNext = roundNumber === currentRound + 1 && paidCurrent;
  if (roundNumber > currentRound && !earlyNext) return refused("ROUND_NOT_OPEN");
  if (attempt?.status === "PAID") return refused("ALREADY_PAID");
  if (attempt?.status === "PENDING" && now.getTime() - attempt.requestedAt.getTime() < PAYMENT_WAIT_MS) {
    return refused("PAYMENT_IN_PROGRESS");
  }
  return allowed;
}

// ---------- The solidarity reserve (D68) ----------

// The share of each contribution set aside in the group's reserve, in percent.
export const RESERVE_PERCENT = 2;

// Whole FCFA, rounded down: 100 FCFA of a 5 000 FCFA contribution.
export function reserveShare(amountFcfa: number): number {
  return Math.floor((amountFcfa * RESERVE_PERCENT) / 100);
}

// What one member's contribution brings to the pot once the reserve's share
// is set aside. A full pot is this times the number of members.
export function potShare(amountFcfa: number): number {
  return amountFcfa - reserveShare(amountFcfa);
}

// ---------- Paying out (Sprint 4) ----------

export type PayoutDecision = "WAIT" | "HOLD" | "SEND";

// What to do with a round's pot today (D48):
// - WAIT before the due date: members expect the pot on the agreed day.
// - SEND on or after the due date once every member has paid.
// - HOLD on or after the due date while the pot is not full: nothing is sent
//   short, and the payout leaves as soon as the last payment arrives.
export function decidePayout(dueDate: Date, today: Date, paidCount: number, size: number): PayoutDecision {
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (day < dueDay) return "WAIT";
  return paidCount >= size ? "SEND" : "HOLD";
}
