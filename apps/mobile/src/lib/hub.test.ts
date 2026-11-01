import type { GroupSummary } from "@novi/shared";
import { describe, expect, it } from "vitest";
import { cardsInOrder, owes, payTarget } from "./hub";

// D92: what home shows first, and what the Payer button does.
function group(name: string, status: "UNPAID" | "FAILED" | "PENDING" | "PAID" | null): GroupSummary {
  return {
    id: name,
    name,
    currentRound: status === null ? null : { myStatus: status },
  } as unknown as GroupSummary;
}

describe("home and the Payer button", () => {
  it("counts a failed payment as still owed, and a pending one as not", () => {
    expect(owes(group("a", "UNPAID"))).toBe(true);
    expect(owes(group("b", "FAILED"))).toBe(true);
    expect(owes(group("c", "PENDING"))).toBe(false);
    expect(owes(group("d", "PAID"))).toBe(false);
    expect(owes(group("e", null))).toBe(false);
  });

  it("shows running groups only, the ones she owes first, otherwise in their order", () => {
    const order = cardsInOrder([
      group("paid", "PAID"),
      group("setup", null),
      group("owes1", "UNPAID"),
      group("pending", "PENDING"),
      group("owes2", "FAILED"),
    ]).map((g) => g.name);
    expect(order).toEqual(["owes1", "owes2", "paid", "pending"]);
  });

  it("goes straight to the one round she owes", () => {
    const target = payTarget([group("paid", "PAID"), group("owes", "UNPAID")]);
    expect(target).toEqual({ kind: "one", group: expect.objectContaining({ name: "owes" }) });
  });

  it("asks which group when she owes in several", () => {
    const target = payTarget([group("a", "UNPAID"), group("b", "FAILED"), group("c", "PAID")]);
    expect(target.kind).toBe("pick");
    expect(target.kind === "pick" && target.groups.map((g) => g.name)).toEqual(["a", "b"]);
  });

  it("says there is nothing to pay when everything is paid or pending", () => {
    expect(payTarget([group("a", "PAID"), group("b", "PENDING")])).toEqual({ kind: "none" });
    expect(payTarget([])).toEqual({ kind: "none" });
  });
});
