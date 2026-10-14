import { describe, expect, it } from "vitest";
import { isWeakPin } from "./pinRules.js";

describe("PIN rules", () => {
  it("refuses one digit repeated", () => {
    expect(isWeakPin("0000")).toBe(true);
    expect(isWeakPin("7777")).toBe(true);
  });

  it("refuses straight sequences in either direction", () => {
    expect(isWeakPin("1234")).toBe(true);
    expect(isWeakPin("6789")).toBe(true);
    expect(isWeakPin("4321")).toBe(true);
  });

  it("refuses the most common choices", () => {
    expect(isWeakPin("1212")).toBe(true);
    expect(isWeakPin("2580")).toBe(true);
  });

  it("accepts a PIN with no obvious pattern", () => {
    expect(isWeakPin("4829")).toBe(false);
    expect(isWeakPin("1357")).toBe(false);
  });
});