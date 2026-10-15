import { randomUUID } from "node:crypto";
import type { AuthResponse } from "@novi/shared";
import request from "supertest";
import { app } from "../app.js";
import { identity, sms } from "../providers/index.js";
import { MockAnidProvider } from "../providers/identity/MockAnidProvider.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";

if (!(sms instanceof MockSmsProvider) || !(identity instanceof MockAnidProvider)) {
  throw new Error("Tests require the mock SMS and ANID providers.");
}
const outbox = sms.sent;
const anid = identity;

// Akossiwa's record in the mock ANID register.
export const AKOSSIWA = { niu: "TEST-0001", legalName: "Akossiwa Afi Mensah", dateOfBirth: "1984-03-12" };

// Completes the SMS step for a phone and returns its sign-up verification token.
export async function verifiedPhone(phone: string): Promise<string> {
  const { body } = await request(app).post("/v1/auth/otp").send({ phone, purpose: "SIGN_UP", language: "FR" });
  const code = outbox.at(-1)?.text.match(/\d{6}/)?.[0];
  if (!code) throw new Error("no SMS code");
  const res = await request(app).post("/v1/auth/otp/verify").send({ challengeId: body.challengeId, code });
  return res.body.verificationToken;
}

// Completes the ANID check and returns the identity token.
export async function verifiedIdentity(verificationToken: string, details = AKOSSIWA): Promise<string> {
  const start = await request(app)
    .post("/v1/auth/identity/start")
    .send({ verificationToken, consentToIdCheck: true, ...details });
  const code = [...anid.sentCodes.values()].at(-1);
  if (!code) throw new Error("no ANID code");
  const res = await request(app)
    .post("/v1/auth/identity/confirm")
    .send({ verificationToken, pendingToken: start.body.pendingToken, code });
  return res.body.identityToken;
}

// Signs a member up through the real endpoints and returns her tokens, profile
// and the installation ID of the phone she signed up on (now trusted).
export async function signedUpMember(phone = "+22890000001", installationId = randomUUID()) {
  const verificationToken = await verifiedPhone(phone);
  const identityToken = await verifiedIdentity(verificationToken);
  const res = await request(app).post("/v1/auth/register").send({
    verificationToken,
    identityToken,
    pin: "4829",
    displayName: "Akossiwa",
    area: "Bè",
    market: "Assigamé",
    language: "FR",
    installationId,
    acceptedTerms: true,
    acceptedCreditDataUse: true,
  });
  if (res.status !== 201) throw new Error(`sign-up failed: ${JSON.stringify(res.body)}`);
  return { ...(res.body as AuthResponse), installationId };
}