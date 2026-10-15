import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { signedUpMember } from "./helpers.js";

if (!(sms instanceof MockSmsProvider)) throw new Error("Tests require the mock SMS provider.");
const outbox = sms.sent;

const PHONE = "+22890000001";
const PIN = "4829";
const WRONG = "1357";

function login(pin: string, installationId: string, phone = PHONE) {
  return request(app).post("/v1/auth/login").send({ phone, pin, installationId });
}

// The sign-up SMS was sent seconds ago; move it back so the 60-second wait
// between codes does not block the new-phone code in these tests.
async function olderSignUpCode() {
  await prisma.otpChallenge.updateMany({ data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) } });
}

describe("login", () => {
  let installationId: string;

  beforeEach(async () => {
    ({ installationId } = await signedUpMember(PHONE));
    outbox.length = 0;
  });

  it("logs her in with the right PIN on her trusted phone", async () => {
    const res = await login(PIN, installationId);
    expect(res.status).toBe(200);
    expect(res.body.tokens.accessToken).toBeTypeOf("string");
    expect(await prisma.auditEvent.count({ where: { type: "LOGIN" } })).toBe(1);
  });

  it("refuses a wrong PIN", async () => {
    const res = await login(WRONG, installationId);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("PIN_INVALID");
  });

  it("answers an unknown number exactly like a wrong PIN", async () => {
    const res = await login(PIN, installationId, "+22890000099");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("PIN_INVALID");
  });

  it("locks the account for 15 minutes after 5 wrong PINs, even against the right one", async () => {
    for (let i = 0; i < 4; i++) expect((await login(WRONG, installationId)).body.error.code).toBe("PIN_INVALID");

    const fifth = await login(WRONG, installationId);
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe("PIN_LOCKED");
    expect(fifth.body.error.retryAfterSec).toBe(15 * 60);

    expect((await login(PIN, installationId)).body.error.code).toBe("PIN_LOCKED");
    expect(await prisma.auditEvent.count({ where: { type: "PIN_LOCKED" } })).toBe(1);
  });

  it("locks for longer the second time", async () => {
    for (let i = 0; i < 5; i++) await login(WRONG, installationId);
    await prisma.user.updateMany({ data: { lockedUntil: new Date(Date.now() - 1000) } }); // first lock over

    for (let i = 0; i < 4; i++) await login(WRONG, installationId);
    const res = await login(WRONG, installationId);
    expect(res.body.error.retryAfterSec).toBe(60 * 60);
  });

  it("clears the wrong-PIN count after a right PIN", async () => {
    for (let i = 0; i < 4; i++) await login(WRONG, installationId);
    expect((await login(PIN, installationId)).status).toBe(200);
    for (let i = 0; i < 4; i++) await login(WRONG, installationId);
    expect((await login(WRONG, installationId)).body.error.code).toBe("PIN_LOCKED");
  });

  it("on a new phone, sends an SMS code only after the right PIN", async () => {
    await olderSignUpCode();
    const newPhone = randomUUID();

    expect((await login(WRONG, newPhone)).body.error.code).toBe("PIN_INVALID");
    expect(outbox).toHaveLength(0);

    const res = await login(PIN, newPhone);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NEW_DEVICE");
    expect(res.body.error.challengeId).toBeTypeOf("string");
    expect(outbox).toHaveLength(1);
  });

  it("trusts a new phone after the SMS code and the PIN, then logs in normally", async () => {
    await olderSignUpCode();
    const newPhone = randomUUID();
    const { body } = await login(PIN, newPhone);

    const code = outbox.at(-1)?.text.match(/\d{6}/)?.[0];
    const verified = await request(app)
      .post("/v1/auth/otp/verify")
      .send({ challengeId: body.error.challengeId, code });

    const trusted = await request(app)
      .post("/v1/auth/devices/trust")
      .send({ verificationToken: verified.body.verificationToken, pin: PIN, installationId: newPhone });
    expect(trusted.status).toBe(200);
    expect(await prisma.device.count()).toBe(2);

    expect((await login(PIN, newPhone)).status).toBe(200);
  });
});