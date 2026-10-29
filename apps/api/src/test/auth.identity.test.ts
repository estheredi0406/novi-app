import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { niuKeyedHash } from "../lib/hashing.js";
import { identity, sms } from "../providers/index.js";
import { MockAnidProvider } from "../providers/identity/MockAnidProvider.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";

if (!(sms instanceof MockSmsProvider) || !(identity instanceof MockAnidProvider)) {
  throw new Error("Tests require the mock SMS and ANID providers.");
}
const outbox = sms.sent;
const anid = identity;

const PHONE = "+22890000001";
const AKOSSIWA = { niu: "0000-000-0001", legalName: "Akossiwa Afi Mensah", dateOfBirth: "1984-03-12" };

// Completes the SMS step and returns the sign-up verification token.
async function verifiedPhone(): Promise<string> {
  const { body } = await request(app).post("/v1/auth/otp").send({ phone: PHONE, purpose: "SIGN_UP", language: "FR" });
  const code = outbox.at(-1)?.text.match(/\d{6}/)?.[0];
  if (!code) throw new Error("no SMS code");
  const res = await request(app).post("/v1/auth/otp/verify").send({ challengeId: body.challengeId, code });
  return res.body.verificationToken;
}

function startCheck(verificationToken: string, details = AKOSSIWA, consentToIdCheck = true) {
  return request(app).post("/v1/auth/identity/start").send({ verificationToken, consentToIdCheck, ...details });
}

function confirmCheck(verificationToken: string, pendingToken: string, code: string) {
  return request(app).post("/v1/auth/identity/confirm").send({ verificationToken, pendingToken, code });
}

// The code the mock ANID "sent" most recently.
function lastAnidCode(): string {
  const code = [...anid.sentCodes.values()].at(-1);
  if (!code) throw new Error("no ANID code");
  return code;
}

describe("identity check", () => {
  it("sends an ANID code when the details match, showing only part of the phone", async () => {
    const res = await startCheck(await verifiedPhone());
    expect(res.status).toBe(200);
    expect(res.body.pendingToken).toBeTypeOf("string");
    expect(res.body.maskedPhone).toBe("+228 ** ** 00 01");
  });

  it("reads the NIU in the card's 4-3-4 format, with or without dashes", async () => {
    const res = await startCheck(await verifiedPhone(), { ...AKOSSIWA, niu: " 00000000001 " });
    expect(res.status).toBe(200);
  });

  it("refuses an NIU that is not 11 digits, before contacting ANID", async () => {
    const res = await startCheck(await verifiedPhone(), { ...AKOSSIWA, niu: "TEST-0001" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses to contact ANID without consent", async () => {
    const res = await startCheck(await verifiedPhone(), AKOSSIWA, false);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });

  it("refuses without a phone verified for sign-up", async () => {
    const res = await startCheck("not-a-token");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("refuses details that do not match ANID's record", async () => {
    const res = await startCheck(await verifiedPhone(), { ...AKOSSIWA, dateOfBirth: "1984-03-13" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ID_MISMATCH");
  });

  it("blocks an NIU for 24 hours after 3 failed checks, even with correct details", async () => {
    const token = await verifiedPhone();
    const wrong = { ...AKOSSIWA, dateOfBirth: "1984-03-13" };
    expect((await startCheck(token, wrong)).body.error.code).toBe("ID_MISMATCH");
    expect((await startCheck(token, wrong)).body.error.code).toBe("ID_MISMATCH");

    const third = await startCheck(token, wrong);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("ID_BLOCKED");
    expect(third.body.error.retryAfterSec).toBeGreaterThan(23 * 3600);

    expect((await startCheck(token)).body.error.code).toBe("ID_BLOCKED");
  });

  it("confirms identity with the right ANID code", async () => {
    const token = await verifiedPhone();
    const { body } = await startCheck(token);
    const res = await confirmCheck(token, body.pendingToken, lastAnidCode());
    expect(res.status).toBe(200);
    expect(res.body.identityToken).toBeTypeOf("string");
    expect(res.body.legalName).toBe("Akossiwa Afi Mensah");
  });

  it("refuses a wrong ANID code", async () => {
    const token = await verifiedPhone();
    const { body } = await startCheck(token);
    const wrong = lastAnidCode() === "000000" ? "111111" : "000000";
    const res = await confirmCheck(token, body.pendingToken, wrong);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ID_CODE_INVALID");
  });

  it("refuses a second account for the same person, but only after ANID confirms her", async () => {
    await prisma.user.create({
      data: {
        phone: "+22890000009",
        legalName: "AKOSSIWA AFI MENSAH",
        displayName: "Akossiwa",
        area: "Bè",
        language: "FR",
        pinHash: "not-used-in-this-test",
        niuKeyedHash: niuKeyedHash("0000-000-0001"),
        idVerifiedAt: new Date(),
      },
    });
    const token = await verifiedPhone();
    const { body } = await startCheck(token);
    expect(body.pendingToken).toBeTypeOf("string"); // nothing revealed yet

    const res = await confirmCheck(token, body.pendingToken, lastAnidCode());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NIU_ALREADY_REGISTERED");
  });
});