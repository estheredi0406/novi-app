import { describe, expect, it } from "vitest";
import { drawOrder } from "./payoutOrder.js";

const MEMBERS = ["Akossiwa", "Abla", "Koffi"];

describe("drawing the payout order", () => {
  it("puts every member in the order exactly once", () => {
    const order = drawOrder(MEMBERS);
    expect([...order].sort()).toEqual([...MEMBERS].sort());
  });

  it("follows the random numbers it is given, so the shuffle itself can be checked", () => {
    // Always picking 0: Koffi swaps with Akossiwa, then Abla with Koffi.
    expect(drawOrder(MEMBERS, () => 0)).toEqual(["Abla", "Koffi", "Akossiwa"]);
    // Always picking the last place: nothing moves.
    expect(drawOrder(MEMBERS, (max) => max - 1)).toEqual(MEMBERS);
  });

  it("gives each member a fair chance of being paid first", () => {
    const first = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const name = drawOrder(MEMBERS)[0] as string;
      first.set(name, (first.get(name) ?? 0) + 1);
    }
    // About 1 000 each; 850 to 1 150 leaves room for chance.
    for (const name of MEMBERS) expect(first.get(name)).toBeGreaterThan(850);
    for (const name of MEMBERS) expect(first.get(name)).toBeLessThan(1150);
  });

  it("does not change the list it was given", () => {
    const members = [...MEMBERS];
    drawOrder(members, () => 0);
    expect(members).toEqual(MEMBERS);
  });
});