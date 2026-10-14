import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { verifiedIdentity, verifiedPhone } from "./helpers.js";

const PHONE = "+22890000001";

function registerBody(verificationToken: string, identityToken: string, overrides: Record<string, unknown> = {}) {
  return {
    verificationToken,
    identityToken,
    pin: "4829",
    displayName: "Akossiwa",
    area: "Bè",
    market: "Assigamé",
    language: "FR",
    installationId: randomUUID(),
    acceptedTerms: true,
    acceptedCreditDataUse: true,
    ...overrides,
  };
}

async function signUpTokens(phone = PHONE) {
  const verificationToken = await verifiedPhone(phone);
  const identityToken = await verifiedIdentity(verificationToken);
  return { verificationToken, identityToken };
}

describe("sign-up", () => {
  it("creates the member, logged in, with her legal and display names", async () => {
    const { verificationToken, identityToken } = await signUpTokens();
    const res = await request(app).post("/v1/auth/register").send(registerBody(verificationToken, identityToken));

    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      displayName: "Akossiwa",
      legalName: "Akossiwa Afi Mensah",
      area: "Bè",
      market: "Assigamé",
    });
    const claims = await verifyAccessToken(res.body.tokens.accessToken);
    expect(claims?.userId).toBe(res.body.member.id);
  });

  it("stores the PIN only as a hash, with three consents, a trusted device, a session and an audit entry", async () => {
    const { verificationToken, identityToken } = await signUpTokens();
    const res = await request(app).post("/v1/auth/register").send(registerBody(verificationToken, identityToken));
    const userId = res.body.member.id;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.pinHash).not.toContain("4829");
    expect(await prisma.consent.count({ where: { userId } })).toBe(3);
    expect(await prisma.device.count({ where: { userId } })).toBe(1);
    expect(await prisma.session.count({ where: { userId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { userId, type: "USER_REGISTERED" } })).toBe(1);
  });

  it("refuses an easy PIN and creates nothing", async () => {
    const { verificationToken, identityToken } = await signUpTokens();
    const res = await request(app)
      .post("/v1/auth/register")
      .send(registerBody(verificationToken, identityToken, { pin: "1234" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PIN_TOO_WEAK");
    expect(await prisma.user.count()).toBe(0);
  });

  it("refuses without accepting the Novi rules", async () => {
    const { verificationToken, identityToken } = await signUpTokens();
    const res = await request(app)
      .post("/v1/auth/register")
      .send(registerBody(verificationToken, identityToken, { acceptedTerms: false }));
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });

  it("refuses an identity proof that belongs to another phone", async () => {
    const someoneElse = await signUpTokens("+22890000005");
    const mine = await verifiedPhone(PHONE);
    const res = await request(app)
      .post("/v1/auth/register")
      .send(registerBody(mine, someoneElse.identityToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses to register the same phone twice", async () => {
    const { verificationToken, identityToken } = await signUpTokens();
    await request(app).post("/v1/auth/register").send(registerBody(verificationToken, identityToken));
    const again = await request(app).post("/v1/auth/register").send(registerBody(verificationToken, identityToken));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("PHONE_ALREADY_REGISTERED");
  });
});