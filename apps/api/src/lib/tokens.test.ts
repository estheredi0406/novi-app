import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessToken, verifyAccessToken } from "./tokens.js";

const claims = { userId: "user-1", sessionId: "session-1" };

describe("access tokens", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a token it issued", async () => {
    const token = await createAccessToken(claims);
    expect(await verifyAccessToken(token)).toEqual(claims);
  });

  it("refuses a token whose contents were altered", async () => {
    const mine = (await createAccessToken(claims)).split(".");
    const other = (await createAccessToken({ userId: "user-2", sessionId: "session-2" })).split(".");
    // Someone else's contents, with my signature: the signature no longer matches.
    const forged = [mine[0], other[1], mine[2]].join(".");
    expect(await verifyAccessToken(forged)).toBeNull();
  });

  it("refuses a token after 15 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const token = await createAccessToken(claims);
    vi.setSystemTime(new Date("2026-10-14T10:16:00Z"));
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("refuses something that is not a token", async () => {
    expect(await verifyAccessToken("not-a-token")).toBeNull();
  });
});