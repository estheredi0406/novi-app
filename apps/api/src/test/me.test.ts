import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { signedUpMember } from "./helpers.js";

function getMe(accessToken?: string) {
  const req = request(app).get("/v1/me");
  return accessToken ? req.set("Authorization", `Bearer ${accessToken}`) : req;
}

describe("her profile", () => {
  it("returns her profile with a valid access token", async () => {
    const { tokens, member } = await signedUpMember();
    const res = await getMe(tokens.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(member);
  });

  it("never returns the PIN hash or NIU hash", async () => {
    const { tokens } = await signedUpMember();
    const res = await getMe(tokens.accessToken);
    expect(res.body).not.toHaveProperty("pinHash");
    expect(res.body).not.toHaveProperty("niuKeyedHash");
  });

  it("refuses a request with no token", async () => {
    const res = await getMe();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a token that is not genuine", async () => {
    const res = await getMe("not-a-real-token");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a genuine token as soon as its session is revoked", async () => {
    const { tokens, member } = await signedUpMember();
    await prisma.session.updateMany({ where: { userId: member.id }, data: { revokedAt: new Date() } });
    const res = await getMe(tokens.accessToken);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_REVOKED");
  });

  it("lets her change her display name, area, market and language", async () => {
    const { tokens } = await signedUpMember();
    const res = await request(app)
      .patch("/v1/me")
      .set("Authorization", `Bearer ${tokens.accessToken}`)
      .send({ displayName: "Maman Afi", area: "Agoè", market: null, language: "EE" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: "Maman Afi", area: "Agoè", market: null, language: "EE" });
  });

  it("refuses any attempt to change her legal name", async () => {
    const { tokens } = await signedUpMember();
    const res = await request(app)
      .patch("/v1/me")
      .set("Authorization", `Bearer ${tokens.accessToken}`)
      .send({ legalName: "SOMEONE ELSE" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});