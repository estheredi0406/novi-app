import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";

if (!(sms instanceof MockSmsProvider)) throw new Error("Tests require the mock SMS provider.");
const outbox = sms.sent;

const NEW_NUMBER = "+22890000001";

// Reads the 6-digit code from the last SMS the mock "sent".
function lastCode(): string {
  const match = outbox.at(-1)?.text.match(/\d{6}/);
  if (!match) throw new Error("no code in the last SMS");
  return match[0];
}

async function askForCode(phone = NEW_NUMBER, purpose = "SIGN_UP") {
  return request(app).post("/v1/auth/otp").send({ phone, purpose, language: "FR" });
}

async function verify(challengeId: string, code: string) {
  return request(app).post("/v1/auth/otp/verify").send({ challengeId, code });
}

describe("SMS codes", () => {
  beforeEach(() => {
    outbox.length = 0;
  });

  it("sends a sign-up code to a new number", async () => {
    const res = await askForCode();
    expect(res.status).toBe(201);
    expect(res.body.challengeId).toBeTypeOf("string");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe(NEW_NUMBER);
  });

  it("refuses a second code within 60 seconds", async () => {
    await askForCode();
    const res = await askForCode();
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("OTP_RATE_LIMITED");
    expect(res.body.error.retryAfterSec).toBeGreaterThan(0);
  });

  it("accepts the right code once, then never again", async () => {
    const { body } = await askForCode();
    const code = lastCode();

    const first = await verify(body.challengeId, code);
    expect(first.status).toBe(200);
    expect(first.body.verificationToken).toBeTypeOf("string");

    const second = await verify(body.challengeId, code);
    expect(second.body.error.code).toBe("OTP_EXPIRED");
  });

  it("refuses a wrong code", async () => {
    const { body } = await askForCode();
    const wrong = lastCode() === "000000" ? "111111" : "000000";
    const res = await verify(body.challengeId, wrong);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });

  it("locks the code after 5 wrong attempts, even if the right one follows", async () => {
    const { body } = await askForCode();
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await verify(body.challengeId, wrong);
    expect((await verify(body.challengeId, wrong)).body.error.code).toBe("OTP_TOO_MANY_ATTEMPTS");
    expect((await verify(body.challengeId, code)).body.error.code).toBe("OTP_TOO_MANY_ATTEMPTS");
  });

  it("refuses a code after 5 minutes", async () => {
    const { body } = await askForCode();
    const code = lastCode();
    await prisma.otpChallenge.update({
      where: { id: body.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await verify(body.challengeId, code)).body.error.code).toBe("OTP_EXPIRED");
  });

  it("rejects a number that is not Togolese", async () => {
    const res = await askForCode("90000001");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("answers a PIN reset for an unknown number the same way, but sends nothing", async () => {
    const res = await askForCode("+22890000002", "PIN_RESET");
    expect(res.status).toBe(201);
    expect(res.body.challengeId).toBeTypeOf("string");
    expect(outbox).toHaveLength(0);
  });

  it("tells an existing member by SMS instead of sending a sign-up code", async () => {
    await prisma.user.create({
      data: {
        phone: NEW_NUMBER,
        fullName: "Akossiwa Afi Mensah",
        area: "Bè",
        language: "FR",
        pinHash: "not-used-in-this-test",
        niuKeyedHash: "not-used-in-this-test",
        idVerifiedAt: new Date(),
      },
    });
    const res = await askForCode();
    expect(res.status).toBe(201);
    expect(outbox[0]?.text).toContain("déjà un");
    expect(outbox[0]?.text).not.toMatch(/\d{6}/);
  });
});