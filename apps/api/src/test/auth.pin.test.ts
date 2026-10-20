import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { signedUpMember, verifiedPhone } from "./helpers.js";

if (!(sms instanceof MockSmsProvider)) throw new Error("Tests require the mock SMS provider.");
const outbox = sms.sent;

const PHONE = "+22890000001";
const OLD_PIN = "4829";
const NEW_PIN = "7351";

// Requests a PIN-reset code and verifies it, returning the PIN_RESET stamp.
async function resetStamp(): Promise<string> {
  // Move earlier codes back, so the 60-second wait between codes does not apply.
  await prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) } });
  const { body } = await request(app).post("/v1/auth/otp").send({ phone: PHONE, purpose: "PIN_RESET", language: "FR" });
  const code = outbox.at(-1)?.text.match(/\d{6}/)?.[0];
  const res = await request(app).post("/v1/auth/otp/verify").send({ challengeId: body.challengeId, code });
  return res.body.verificationToken;
}

function resetPin(verificationToken: string, newPin = NEW_PIN) {
  return request(app).post("/v1/auth/pin/reset").send({ verificationToken, newPin });
}

function login(pin: string, installationId: string) {
  return request(app).post("/v1/auth/login").send({ phone: PHONE, pin, installationId });
}

describe("forgotten PIN", () => {
  it("sets a new PIN: the old one stops working, the new one logs her in", async () => {
    const { installationId } = await signedUpMember(PHONE);
    expect((await resetPin(await resetStamp())).status).toBe(204);

    expect((await login(OLD_PIN, installationId)).body.error.code).toBe("PIN_INVALID");
    expect((await login(NEW_PIN, installationId)).status).toBe(200);
  });

  it("logs her out on every phone", async () => {
    const { tokens } = await signedUpMember(PHONE);
    await resetPin(await resetStamp());
    const res = await request(app).get("/v1/me").set("Authorization", `Bearer ${tokens.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("SESSION_REVOKED");
  });

  it("lifts a lockout", async () => {
    const { installationId } = await signedUpMember(PHONE);
    for (let i = 0; i < 5; i++) await login("1357", installationId);
    expect((await login(OLD_PIN, installationId)).body.error.code).toBe("PIN_LOCKED");

    await resetPin(await resetStamp());
    expect((await login(NEW_PIN, installationId)).status).toBe(200);
  });

  it("refuses an easy new PIN", async () => {
    await signedUpMember(PHONE);
    const res = await resetPin(await resetStamp(), "0000");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PIN_TOO_WEAK");
  });

  it("refuses a stamp from another flow, such as sign-up", async () => {
    await signedUpMember("+22890000002");
    const signUpStamp = await verifiedPhone(PHONE);
    const res = await resetPin(signUpStamp);
    expect(res.status).toBe(401);
  });

  it("accepts each reset stamp only once", async () => {
    await signedUpMember(PHONE);
    const stamp = await resetStamp();
    expect((await resetPin(stamp)).status).toBe(204);
    expect((await resetPin(stamp, "8264")).status).toBe(401);
  });
});