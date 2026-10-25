import { describe, expect, it } from "vitest";
import { onTimeStreak } from "./streak.js";

const DAY = 24 * 60 * 60 * 1000;
const d = (n: number) => n * DAY; // day n
const TODAY = d(30);

describe("on-time streak", () => {
  it("counts payments on or before the due date, from the latest back", () => {
    expect(onTimeStreak([{ dueDay: d(7), paidDay: d(5) }, { dueDay: d(14), paidDay: d(14) }, { dueDay: d(21), paidDay: d(20) }], TODAY)).toBe(3);
  });

  it("is ended by a late payment", () => {
    expect(onTimeStreak([{ dueDay: d(7), paidDay: d(6) }, { dueDay: d(14), paidDay: d(15) }, { dueDay: d(21), paidDay: d(21) }], TODAY)).toBe(1);
  });

  it("is ended by a missed round whose day has passed", () => {
    expect(onTimeStreak([{ dueDay: d(7), paidDay: d(6) }, { dueDay: d(14), paidDay: null }], TODAY)).toBe(0);
  });

  it("is not broken by this week's round she still has time to pay", () => {
    expect(onTimeStreak([{ dueDay: d(21), paidDay: d(20) }, { dueDay: d(35), paidDay: null }], TODAY)).toBe(1);
  });

  it("is 0 before any payment", () => {
    expect(onTimeStreak([], TODAY)).toBe(0);
  });
});
