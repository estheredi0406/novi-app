import { describe, expect, it } from "vitest";
import { currentRoundNumber, dueDates, firstDueDate, isoDay } from "./schedule.js";

// Wednesday 21 October 2026, mid-afternoon in Lomé.
const WEDNESDAY = new Date("2026-10-21T15:40:00Z");

describe("the first due date", () => {
  it("is the coming Friday for a Friday group started on a Wednesday", () => {
    expect(isoDay(firstDueDate(WEDNESDAY, "WEEKLY", 5))).toBe("2026-10-23");
  });

  it("is a week later, never the same day, for a Friday group started on a Friday", () => {
    expect(isoDay(firstDueDate(new Date("2026-10-23T08:00:00Z"), "WEEKLY", 5))).toBe("2026-10-30");
  });

  it("handles Sunday, which JavaScript counts as 0 and Novi as 7", () => {
    expect(isoDay(firstDueDate(WEDNESDAY, "WEEKLY", 7))).toBe("2026-10-25");
  });

  it("is later this month when the day has not passed, and next month when it has", () => {
    expect(isoDay(firstDueDate(WEDNESDAY, "MONTHLY", 28))).toBe("2026-10-28");
    expect(isoDay(firstDueDate(WEDNESDAY, "MONTHLY", 5))).toBe("2026-11-05");
    expect(isoDay(firstDueDate(WEDNESDAY, "MONTHLY", 21))).toBe("2026-11-21");
  });
});

describe("the calendar of rounds", () => {
  it("spaces weekly rounds 7 days apart", () => {
    expect(dueDates(WEDNESDAY, "WEEKLY", 5, 3).map(isoDay)).toEqual(["2026-10-23", "2026-10-30", "2026-11-06"]);
  });

  it("keeps the same day each month, across the end of the year", () => {
    expect(dueDates(WEDNESDAY, "MONTHLY", 15, 4).map(isoDay)).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
      "2027-02-15",
    ]);
  });
});

describe("the round open for payment", () => {
  const rounds = dueDates(WEDNESDAY, "WEEKLY", 5, 3); // 23 Oct, 30 Oct, 6 Nov

  it("is round 1 until its due date has passed", () => {
    expect(currentRoundNumber(rounds, WEDNESDAY)).toBe(1);
    expect(currentRoundNumber(rounds, new Date("2026-10-23T22:00:00Z"))).toBe(1);
  });

  it("moves to round 2 the day after round 1 is due", () => {
    expect(currentRoundNumber(rounds, new Date("2026-10-24T06:00:00Z"))).toBe(2);
  });

  it("stays on the last round once every date has passed", () => {
    expect(currentRoundNumber(rounds, new Date("2027-01-01T00:00:00Z"))).toBe(3);
  });
});
