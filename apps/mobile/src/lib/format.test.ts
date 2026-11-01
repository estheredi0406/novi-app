import { describe, expect, it } from "vitest";
import { daysUntil, formatDay, formatFcfa, formatPhone, formatSeconds, shortDay } from "./format";

// Amounts, dates and numbers are written by hand, so every phone shows the
// same thing whatever its language settings (D22).
describe("formatting for Lomé", () => {
  it("puts a space between thousands, as French and Togolese usage does", () => {
    expect(formatFcfa(5000)).toBe("5 000 FCFA");
    expect(formatFcfa(58800)).toBe("58 800 FCFA");
    expect(formatFcfa(1000000)).toBe("1 000 000 FCFA");
    expect(formatFcfa(100)).toBe("100 FCFA");
  });

  it("writes a Togolese number in pairs", () => {
    expect(formatPhone("+22890123456")).toBe("+228 90 12 34 56");
  });

  it("writes dates day first, and counts seconds as minutes", () => {
    expect(formatDay("2026-11-06")).toBe("06/11/2026");
    expect(formatSeconds(75)).toBe("1:15");
    expect(formatSeconds(9)).toBe("0:09");
  });

  it("counts whole days in GMT, whatever the hour", () => {
    const sundayEvening = new Date("2026-11-01T23:30:00Z");
    expect(daysUntil("2026-11-06", sundayEvening)).toBe(5);
    expect(daysUntil("2026-11-01", sundayEvening)).toBe(0);
    expect(daysUntil("2026-10-30", sundayEvening)).toBe(-2);
  });

  it("names the day as people say it at the market", () => {
    expect(shortDay("2026-11-06", "fr")).toMatch(/ven\.? 6 nov/);
    expect(shortDay("2026-11-06", "en")).toMatch(/Fri,? 6 Nov/);
  });
});
