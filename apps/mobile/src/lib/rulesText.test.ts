import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import fr from "../i18n/fr.json";
import { rulesSummary, scheduleText } from "./rulesText";

// A small stand-in for i18next that reads the real French file, so the test
// also catches a key missing from fr.json.
const t = ((key: string, params: Record<string, unknown> = {}) => {
  const count = typeof params.count === "number" ? params.count : undefined;
  const lookup = (k: string) => k.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], fr);
  const text =
    (count !== undefined ? lookup(`${key}_${count === 1 ? "one" : "other"}`) : undefined) ?? lookup(key);
  if (typeof text !== "string") throw new Error(`Missing French text: ${key}`);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name]));
}) as unknown as TFunction;

describe("the rules in one line, in French", () => {
  it("says the rhythm for each frequency (D30, D92)", () => {
    expect(scheduleText(t, "DAILY", 1)).toBe("chaque jour sauf dimanche");
    expect(scheduleText(t, "WEEKLY", 5)).toBe("chaque vendredi");
    expect(scheduleText(t, "MONTHLY", 15)).toBe("le 15 de chaque mois");
  });

  it("joins amount, rhythm and size", () => {
    expect(rulesSummary(t, { amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 12 })).toBe(
      "5 000 FCFA chaque vendredi · 12 membres",
    );
  });
});
