import { randomInt } from "node:crypto";
import type { OtpChallenge, PhoneVerification } from "@novi/shared";
import type { Language, OtpPurpose } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { hashSecret, verifySecret } from "../lib/hashing.js";
import { alreadyRegisteredSms, otpSms } from "../lib/smsText.js";
import { createStepToken } from "../lib/tokens.js";
import { sms } from "../providers/index.js";

const CODE_LIFETIME_SEC = 5 * 60;
const RESEND_WAIT_SEC = 60;
const MAX_CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const VERIFICATION_TOKEN_MINUTES = 10;

// Codes a member can request directly. NEW_DEVICE codes are issued by login.
export type PublicOtpPurpose = "SIGN_UP" | "PIN_RESET";

// Refuses a new code if this phone asked too recently or too often.
// Counted in the database, so limits survive an API restart.
async function enforcePhoneLimits(phone: string): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.otpChallenge.findMany({
    where: { phone, createdAt: { gte: oneHourAgo } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const latest = recent[0];
  if (latest) {
    const secondsSince = (Date.now() - latest.createdAt.getTime()) / 1000;
    if (secondsSince < RESEND_WAIT_SEC) {
      throw new AppError("OTP_RATE_LIMITED", 429, Math.ceil(RESEND_WAIT_SEC - secondsSince));
    }
  }

  const oldest = recent[recent.length - 1];
  if (recent.length >= MAX_CODES_PER_HOUR && oldest) {
    const secondsSince = (Date.now() - oldest.createdAt.getTime()) / 1000;
    throw new AppError("OTP_RATE_LIMITED", 429, Math.ceil(3600 - secondsSince));
  }
}

// Creates a challenge after checking the phone's limits, and returns its ID
// and the code. The caller decides whether and what to send.
async function newChallenge(phone: string, purpose: OtpPurpose) {
  await enforcePhoneLimits(phone);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const challenge = await prisma.otpChallenge.create({
    data: {
      phone,
      purpose,
      codeHash: await hashSecret(code),
      expiresAt: new Date(Date.now() + CODE_LIFETIME_SEC * 1000),
    },
  });
  return { challengeId: challenge.id, code };
}

// Creates a challenge and sends the right SMS. The response is identical whether
// or not the phone has an account, so the API never reveals who uses Novi.
export async function requestOtp(input: {
  phone: string;
  purpose: PublicOtpPurpose;
  language: Language;
}): Promise<OtpChallenge> {
  const { phone, purpose, language } = input;
  const hasAccount = (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) !== null;

  // A challenge is always created, even when no code is sent, so that
  // verifying behaves the same for every number.
  const { challengeId, code } = await newChallenge(phone, purpose);

  if (purpose === "SIGN_UP") {
    await sms.send(phone, hasAccount ? alreadyRegisteredSms(language) : otpSms(language, code));
  } else if (hasAccount) {
    await sms.send(phone, otpSms(language, code));
  }

  return { challengeId, expiresInSec: CODE_LIFETIME_SEC, resendInSec: RESEND_WAIT_SEC };
}

// Sends a code to confirm a new phone. Called by login only after the right PIN.
export async function sendDeviceCode(phone: string, language: Language): Promise<string> {
  const { challengeId, code } = await newChallenge(phone, "NEW_DEVICE");
  await sms.send(phone, otpSms(language, code));
  return challengeId;
}

// Checks a code. On success the challenge is used up and a 10-minute
// verification token proves the phone was confirmed for this purpose.
export async function verifyOtp(input: { challengeId: string; code: string }): Promise<PhoneVerification> {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
    throw new AppError("OTP_EXPIRED", 400);
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    throw new AppError("OTP_TOO_MANY_ATTEMPTS", 429);
  }

  if (!(await verifySecret(challenge.codeHash, input.code))) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= MAX_ATTEMPTS) throw new AppError("OTP_TOO_MANY_ATTEMPTS", 429);
    throw new AppError("OTP_INVALID", 400);
  }

  // Marks the code as used only if nobody used it first, so two requests
  // arriving at the same moment cannot both succeed.
  const { count } = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) throw new AppError("OTP_EXPIRED", 400);

  const verificationToken = await createStepToken(challenge.purpose, challenge.phone, VERIFICATION_TOKEN_MINUTES);
  return { verificationToken, expiresInSec: VERIFICATION_TOKEN_MINUTES * 60 };
}