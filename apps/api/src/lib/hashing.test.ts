import { describe, expect, it } from "vitest";
import { hashSecret, hashToken, newRandomToken, niuKeyedHash, verifySecret } from "./hashing.js";

describe("hashing", () => {
  it("never stores the PIN in readable form", async () => {
    const hash = await hashSecret("1234");
    expect(hash).not.toContain("1234");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("accepts the right PIN and refuses a wrong one", async () => {
    const hash = await hashSecret("1234");
    expect(await verifySecret(hash, "1234")).toBe(true);
    expect(await verifySecret(hash, "1235")).toBe(false);
  });

  it("gives two members with the same PIN different hashes", async () => {
    expect(await hashSecret("1234")).not.toBe(await hashSecret("1234"));
  });

  it("finds the same refresh token hash every time", () => {
    const token = newRandomToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("never issues the same refresh token twice", () => {
    expect(newRandomToken()).not.toBe(newRandomToken());
  });

  it("gives the same NIU hash regardless of surrounding spaces", () => {
    expect(niuKeyedHash(" 0000-000-0001 ")).toBe(niuKeyedHash("0000-000-0001"));
  });
});