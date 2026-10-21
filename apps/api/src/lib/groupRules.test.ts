import { describe, expect, it } from "vitest";
import {
  checkAction,
  checkAnswersCurrentRules,
  checkCanInvite,
  checkCanJoin,
  checkCanPay,
  checkCanStartAnother,
  checkFixedOrder,
  checkReadyToStart,
  checkRules,
  countsTowardLimit,
  type Seat,
} from "./groupRules.js";

// Akossiwa's group: 5 000 FCFA every Friday, 10 members.
const FRIDAY_GROUP = { amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 10 } as const;

const accepted = (version: number): Seat => ({ state: "ACCEPTED", acceptedVersion: version });
const invited: Seat = { state: "INVITED", acceptedVersion: null };
const declined: Seat = { state: "DECLINED", acceptedVersion: null };

describe("what can be done, when and by whom", () => {
  it("lets the organiser edit the rules while the group is a draft or being decided", () => {
    expect(checkAction("EDIT_RULES", "DRAFT", true)).toEqual({ ok: true });
    expect(checkAction("EDIT_RULES", "PROPOSED", true)).toEqual({ ok: true });
  });

  it("refuses any change to the rules once the group is active", () => {
    expect(checkAction("EDIT_RULES", "ACTIVE", true)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
  });

  it("refuses an invitation from someone who is not the organiser", () => {
    expect(checkAction("INVITE", "PROPOSED", false)).toEqual({ ok: false, reason: "ORGANISER_ONLY" });
  });

  it("lets members answer the rules only while the group is being decided", () => {
    expect(checkAction("RESPOND", "PROPOSED", false)).toEqual({ ok: true });
    expect(checkAction("RESPOND", "DRAFT", false)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
  });

  it("refuses the organiser answering her own proposal", () => {
    expect(checkAction("RESPOND", "PROPOSED", true)).toEqual({ ok: false, reason: "MEMBERS_ONLY" });
  });

  it("lets a member say no before the group starts, even while it is a draft", () => {
    expect(checkAction("DECLINE", "DRAFT", false)).toEqual({ ok: true });
    expect(checkAction("DECLINE", "PROPOSED", false)).toEqual({ ok: true });
    expect(checkAction("DECLINE", "ACTIVE", false)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
    expect(checkAction("DECLINE", "PROPOSED", true)).toEqual({ ok: false, reason: "MEMBERS_ONLY" });
  });

  it("lets the organiser retry a start that is waiting for the MFI, and nothing else", () => {
    expect(checkAction("START", "STARTING", true)).toEqual({ ok: true });
    expect(checkAction("SET_ORDER", "STARTING", true)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
    expect(checkAction("START", "ACTIVE", true)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
  });

  it("refuses cancelling a group once money may move", () => {
    expect(checkAction("CANCEL", "STARTING", true)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
    expect(checkAction("CANCEL", "ACTIVE", true)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
  });
});

describe("the rules a group proposes", () => {
  it("accepts 5 000 FCFA every Friday for 10 members", () => {
    expect(checkRules(FRIDAY_GROUP)).toEqual({ ok: true });
  });

  it("refuses fewer than 3 or more than 15 members", () => {
    expect(checkRules({ ...FRIDAY_GROUP, size: 2 })).toEqual({ ok: false, reason: "SIZE_OUT_OF_RANGE" });
    expect(checkRules({ ...FRIDAY_GROUP, size: 16 })).toEqual({ ok: false, reason: "SIZE_OUT_OF_RANGE" });
  });

  it("refuses amounts that are not whole FCFA or are out of range", () => {
    expect(checkRules({ ...FRIDAY_GROUP, amountFcfa: 2500.5 })).toEqual({ ok: false, reason: "AMOUNT_OUT_OF_RANGE" });
    expect(checkRules({ ...FRIDAY_GROUP, amountFcfa: 50 })).toEqual({ ok: false, reason: "AMOUNT_OUT_OF_RANGE" });
    expect(checkRules({ ...FRIDAY_GROUP, amountFcfa: 5_000_000 })).toEqual({ ok: false, reason: "AMOUNT_OUT_OF_RANGE" });
  });

  it("refuses a weekday after Sunday and a monthly day after the 28th", () => {
    expect(checkRules({ ...FRIDAY_GROUP, dueDay: 8 })).toEqual({ ok: false, reason: "DUE_DAY_OUT_OF_RANGE" });
    expect(checkRules({ ...FRIDAY_GROUP, frequency: "MONTHLY", dueDay: 31 })).toEqual({
      ok: false,
      reason: "DUE_DAY_OUT_OF_RANGE",
    });
    expect(checkRules({ ...FRIDAY_GROUP, frequency: "MONTHLY", dueDay: 28 })).toEqual({ ok: true });
  });
});

describe("answering the rules", () => {
  it("accepts an answer to the current version, and refuses one to an older version", () => {
    expect(checkAnswersCurrentRules(2, 2)).toEqual({ ok: true });
    expect(checkAnswersCurrentRules(1, 2)).toEqual({ ok: false, reason: "RULES_CHANGED" });
  });
});

describe("seats and limits", () => {
  it("refuses an invitation when every seat is held, but counts declined seats as free", () => {
    expect(checkCanInvite([accepted(1), invited, invited], 3)).toEqual({ ok: false, reason: "GROUP_FULL" });
    expect(checkCanInvite([accepted(1), invited, declined], 3)).toEqual({ ok: true });
  });

  it("counts a group towards the limit from her acceptance until it ends", () => {
    expect(countsTowardLimit("PROPOSED", accepted(1))).toBe(true);
    expect(countsTowardLimit("ACTIVE", accepted(1))).toBe(true);
    expect(countsTowardLimit("PROPOSED", invited)).toBe(false);
    expect(countsTowardLimit("COMPLETED", accepted(1))).toBe(false);
  });

  it("refuses a 4th active group", () => {
    expect(checkCanJoin(2)).toEqual({ ok: true });
    expect(checkCanJoin(3)).toEqual({ ok: false, reason: "GROUP_LIMIT_REACHED" });
  });

  it("refuses a 3rd start before she has completed a cycle, and allows it after", () => {
    expect(checkCanStartAnother(1, false)).toEqual({ ok: true });
    expect(checkCanStartAnother(2, false)).toEqual({ ok: false, reason: "START_LIMIT_REACHED" });
    expect(checkCanStartAnother(2, true)).toEqual({ ok: true });
  });
});

describe("starting a group", () => {
  it("starts when every seat is filled and everyone accepted the current rules", () => {
    expect(checkReadyToStart([accepted(2), accepted(2), accepted(2)], 3, 2)).toEqual({ ok: true });
  });

  it("refuses to start while a seat is empty", () => {
    expect(checkReadyToStart([accepted(1), accepted(1), declined], 3, 1)).toEqual({
      ok: false,
      reason: "SEATS_NOT_FILLED",
    });
  });

  it("refuses to start while someone has not answered", () => {
    expect(checkReadyToStart([accepted(1), accepted(1), invited], 3, 1)).toEqual({
      ok: false,
      reason: "NOT_EVERYONE_ACCEPTED",
    });
  });

  it("refuses to start when someone accepted an older version of the rules", () => {
    expect(checkReadyToStart([accepted(2), accepted(2), accepted(1)], 3, 2)).toEqual({
      ok: false,
      reason: "NOT_EVERYONE_ACCEPTED",
    });
  });
});

describe("a fixed payout order (D41)", () => {
  const SEATS = ["akossiwa", "abla", "koffi"];

  it("accepts an order naming every member once", () => {
    expect(checkFixedOrder(["abla", "koffi", "akossiwa"], SEATS)).toEqual({ ok: true });
  });

  it("refuses an order that misses someone, names someone twice, or names a stranger", () => {
    const invalid = { ok: false, reason: "ORDER_INVALID" };
    expect(checkFixedOrder(["abla", "koffi"], SEATS)).toEqual(invalid);
    expect(checkFixedOrder(["abla", "abla", "koffi"], SEATS)).toEqual(invalid);
    expect(checkFixedOrder(["abla", "koffi", "efua"], SEATS)).toEqual(invalid);
  });
});

describe("paying a round (Sprint 3)", () => {
  const now = new Date("2026-10-23T09:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

  it("lets anyone in an active group pay, the organiser included, and nobody before it starts", () => {
    expect(checkAction("PAY", "ACTIVE", true)).toEqual({ ok: true });
    expect(checkAction("PAY", "ACTIVE", false)).toEqual({ ok: true });
    expect(checkAction("PAY", "PROPOSED", false)).toEqual({ ok: false, reason: "NOT_ALLOWED_NOW" });
  });

  it("accepts the current round and late ones, and refuses a round not open yet", () => {
    expect(checkCanPay(2, 2, null, now)).toEqual({ ok: true });
    expect(checkCanPay(1, 2, null, now)).toEqual({ ok: true });
    expect(checkCanPay(3, 2, null, now)).toEqual({ ok: false, reason: "ROUND_NOT_OPEN" });
  });

  it("refuses a round already paid", () => {
    expect(checkCanPay(1, 1, { status: "PAID", requestedAt: minutesAgo(60) }, now)).toEqual({
      ok: false,
      reason: "ALREADY_PAID",
    });
  });

  it("does not send a second request while one waits, but allows a new one after 5 minutes or a failure", () => {
    expect(checkCanPay(1, 1, { status: "PENDING", requestedAt: minutesAgo(1) }, now)).toEqual({
      ok: false,
      reason: "PAYMENT_IN_PROGRESS",
    });
    expect(checkCanPay(1, 1, { status: "PENDING", requestedAt: minutesAgo(6) }, now)).toEqual({ ok: true });
    expect(checkCanPay(1, 1, { status: "FAILED", requestedAt: minutesAgo(1) }, now)).toEqual({ ok: true });
  });
});
