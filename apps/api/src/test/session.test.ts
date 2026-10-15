import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { signedUpMember } from "./helpers.js";

function refresh(refreshToken: string) {
  return request(app).post("/v1/auth/refresh").send({ refreshToken });
}

function getMe(accessToken: string) {
  return request(app).get("/v1/me").set("Authorization", `Bearer ${accessToken}`);
}

describe("staying logged in", () => {
  it("swaps a refresh token for a new pair that works", async () => {
    const { tokens } = await signedUpMember();
    const res = await refresh(tokens.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(tokens.refreshToken);
    expect((await getMe(res.body.accessToken)).status).toBe(200);
  });

  it("ends the old access token as soon as it is refreshed", async () => {
    const { tokens } = await signedUpMember();
    await refresh(tokens.refreshToken);
    const res = await getMe(tokens.accessToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_REVOKED");
  });

  it("accepts each refresh token only once, but a quick retry does not log her out", async () => {
    const { tokens } = await signedUpMember();
    const first = await refresh(tokens.refreshToken);

    const again = await refresh(tokens.refreshToken);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("SESSION_REVOKED");

    // As after a lost answer on a weak connection: the new tokens still work.
    expect((await getMe(first.body.accessToken)).status).toBe(200);
  });

  it("logs her out everywhere when an old refresh token is reused later", async () => {
    const { tokens, member } = await signedUpMember();
    const first = await refresh(tokens.refreshToken);

    // The rotation happened a minute ago, beyond the 30-second retry grace.
    await prisma.session.updateMany({
      where: { userId: member.id, revokedReason: "ROTATED" },
      data: { revokedAt: new Date(Date.now() - 60 * 1000) },
    });

    expect((await refresh(tokens.refreshToken)).status).toBe(401);
    expect((await getMe(first.body.accessToken)).status).toBe(401);
    expect(await prisma.auditEvent.count({ where: { type: "REFRESH_TOKEN_REUSED" } })).toBe(1);
  });

  it("refuses a refresh token it never issued", async () => {
    const res = await refresh("made-up-token");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("logs out: the session ends at once, and its refresh token with it", async () => {
    const { tokens } = await signedUpMember();
    const res = await request(app).post("/v1/auth/logout").set("Authorization", `Bearer ${tokens.accessToken}`);
    expect(res.status).toBe(204);
    expect((await getMe(tokens.accessToken)).status).toBe(401);
    expect((await refresh(tokens.refreshToken)).status).toBe(401);
  });

  it("refuses to log out without a token", async () => {
    const res = await request(app).post("/v1/auth/logout");
    expect(res.status).toBe(401);
  });
});