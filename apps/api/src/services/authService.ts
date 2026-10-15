import type { AuthResponse, MemberProfile } from "@novi/shared";
import type { Language, User } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { hashSecret, verifySecret } from "../lib/hashing.js";
import { isWeakPin } from "../lib/pinRules.js";
import { verifyStepToken } from "../lib/tokens.js";
import { sendDeviceCode } from "./otpService.js";
import { openSession, revokeAllSessions } from "./sessionService.js";

// Version of the consent texts shown at sign-up. A new text gets a new version,
// so the database always shows which wording each member agreed to.
const CONSENT_VERSION = "2026-10-14";

const MAX_PIN_ATTEMPTS = 5;
// Lockout lengths in minutes: first lock, second, third and later (D18).
const LOCK_MINUTES = [15, 60, 24 * 60];

// The member as the app shows her; never includes the PIN hash or NIU hash.
export function toMemberProfile(user: User): MemberProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    legalName: user.legalName,
    language: user.language,
    area: user.area,
    market: user.market,
  };
}

// ---------- Sign-up ----------

// Final sign-up step: requires both stamps for the same phone, then creates
// the member, her consents, trusted device, session and audit entry together.
export async function register(input: {
  verificationToken: string;
  identityToken: string;
  pin: string;
  displayName: string;
  area: string;
  market?: string | null;
  language: Language;
  installationId: string;
  acceptedTerms: boolean;
  acceptedCreditDataUse: boolean;
}): Promise<AuthResponse> {
  const phoneStep = await verifyStepToken(input.verificationToken, "SIGN_UP");
  const idStep = await verifyStepToken(input.identityToken, "IDENTITY_VERIFIED");
  if (!phoneStep || !idStep || phoneStep.subject !== idStep.subject) {
    throw new AppError("UNAUTHENTICATED", 401);
  }
  const phone = phoneStep.subject;

  const { niuHash, legalName, idConsentAt, verifiedAt } = idStep.claims;
  if (
    typeof niuHash !== "string" ||
    typeof legalName !== "string" ||
    typeof idConsentAt !== "string" ||
    typeof verifiedAt !== "string"
  ) {
    throw new AppError("UNAUTHENTICATED", 401);
  }

  if (!input.acceptedTerms || !input.acceptedCreditDataUse) throw new AppError("CONSENT_REQUIRED", 400);
  if (isWeakPin(input.pin)) throw new AppError("PIN_TOO_WEAK", 400);

  if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
    throw new AppError("PHONE_ALREADY_REGISTERED", 409);
  }
  if (await prisma.user.findUnique({ where: { niuKeyedHash: niuHash }, select: { id: true } })) {
    throw new AppError("NIU_ALREADY_REGISTERED", 409);
  }

  // Hashing is deliberately slow, so it happens before the transaction opens.
  const pinHash = await hashSecret(input.pin);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phone,
        legalName,
        displayName: input.displayName,
        area: input.area,
        market: input.market ?? null,
        language: input.language,
        pinHash,
        niuKeyedHash: niuHash,
        idVerifiedAt: new Date(verifiedAt),
      },
    });

    await tx.consent.createMany({
      data: [
        // Recorded at the moment she agreed, before her details went to ANID.
        { userId: user.id, type: "ID_CHECK", version: CONSENT_VERSION, acceptedAt: new Date(idConsentAt) },
        { userId: user.id, type: "CREDIT_DATA_USE", version: CONSENT_VERSION, acceptedAt: now },
        { userId: user.id, type: "TERMS", version: CONSENT_VERSION, acceptedAt: now },
      ],
    });

    const device = await tx.device.create({ data: { userId: user.id, installationId: input.installationId } });
    const tokens = await openSession(tx, user.id, device.id);

    // No personal data in the audit details: the user ID already says who.
    await tx.auditEvent.create({ data: { userId: user.id, type: "USER_REGISTERED", details: { deviceId: device.id } } });

    return { tokens, member: toMemberProfile(user) };
  });
}

// ---------- PIN checking and lockout ----------

function lockMinutes(level: number): number {
  return LOCK_MINUTES[Math.min(level, LOCK_MINUTES.length) - 1] ?? 15;
}

// A hash of no real PIN, checked when the phone has no account, so that an
// unknown number takes as long to answer as a wrong PIN and reveals nothing.
let dummyHash: Promise<string> | undefined;
function dummyPinHash(): Promise<string> {
  dummyHash ??= hashSecret("not-a-member-pin");
  return dummyHash;
}

// Checks a PIN with the lockout rules: 5 wrong tries lock the account, each
// lock longer than the last; a right PIN clears the count and the escalation.
async function checkPin(user: User, pin: string): Promise<void> {
  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil.getTime() > now) {
    throw new AppError("PIN_LOCKED", 423, Math.ceil((user.lockedUntil.getTime() - now) / 1000));
  }

  if (await verifySecret(user.pinHash, pin)) {
    if (user.failedPinAttempts > 0 || user.lockoutLevel > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: null },
      });
    }
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedPinAttempts: { increment: 1 } },
  });
  if (updated.failedPinAttempts < MAX_PIN_ATTEMPTS) throw new AppError("PIN_INVALID", 401);

  const level = updated.lockoutLevel + 1;
  const minutes = lockMinutes(level);
  await prisma.user.update({
    where: { id: user.id },
    data: { failedPinAttempts: 0, lockoutLevel: level, lockedUntil: new Date(now + minutes * 60 * 1000) },
  });
  await prisma.auditEvent.create({ data: { userId: user.id, type: "PIN_LOCKED", details: { level, minutes } } });
  throw new AppError("PIN_LOCKED", 423, minutes * 60);
}

// ---------- Login and new phones ----------

// Daily login. On a trusted phone, opens a session. On a new phone, and only
// after the right PIN, sends an SMS code to confirm the phone first.
export async function login(input: { phone: string; pin: string; installationId: string }): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { phone: input.phone } });
  if (!user) {
    await verifySecret(await dummyPinHash(), input.pin);
    throw new AppError("PIN_INVALID", 401);
  }

  await checkPin(user, input.pin);

  const device = await prisma.device.findUnique({
    where: { userId_installationId: { userId: user.id, installationId: input.installationId } },
  });
  if (!device) {
    const challengeId = await sendDeviceCode(user.phone, user.language);
    throw new AppError("NEW_DEVICE", 409, undefined, challengeId);
  }

  return prisma.$transaction(async (tx) => {
    await tx.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    // One session per phone: logging in again closes the phone's previous session (D23).
    await tx.session.updateMany({
      where: { deviceId: device.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "REPLACED" },
    });
    const tokens = await openSession(tx, user.id, device.id);
    await tx.auditEvent.create({ data: { userId: user.id, type: "LOGIN", details: { deviceId: device.id } } });
    return { tokens, member: toMemberProfile(user) };
  });
}

// Trusts a new phone: needs the SMS code (she holds the SIM) and the PIN
// (she knows the secret), then opens a session on that phone.
export async function trustDevice(input: {
  verificationToken: string;
  pin: string;
  installationId: string;
}): Promise<AuthResponse> {
  const step = await verifyStepToken(input.verificationToken, "NEW_DEVICE");
  if (!step) throw new AppError("UNAUTHENTICATED", 401);

  const user = await prisma.user.findUnique({ where: { phone: step.subject } });
  if (!user) throw new AppError("UNAUTHENTICATED", 401);

  await checkPin(user, input.pin);

  return prisma.$transaction(async (tx) => {
    const device = await tx.device.upsert({
      where: { userId_installationId: { userId: user.id, installationId: input.installationId } },
      create: { userId: user.id, installationId: input.installationId },
      update: { lastSeenAt: new Date() },
    });
    const tokens = await openSession(tx, user.id, device.id);
    await tx.auditEvent.create({ data: { userId: user.id, type: "DEVICE_TRUSTED", details: { deviceId: device.id } } });
    return { tokens, member: toMemberProfile(user) };
  });
}

// ---------- Forgotten PIN ----------

// Sets a new PIN after the member proves she holds the SIM (SMS code). Closes
// every session on every phone and lifts any lockout. Each reset stamp works
// once: a stamp issued before the last PIN change is refused (D20).
export async function resetPin(input: { verificationToken: string; newPin: string }): Promise<void> {
  const step = await verifyStepToken(input.verificationToken, "PIN_RESET");
  if (!step) throw new AppError("UNAUTHENTICATED", 401);

  const user = await prisma.user.findUnique({ where: { phone: step.subject } });
  if (!user) throw new AppError("UNAUTHENTICATED", 401);

  const issuedAtMs = typeof step.claims.iat === "number" ? step.claims.iat * 1000 : 0;
  if (user.pinChangedAt && issuedAtMs <= user.pinChangedAt.getTime()) {
    throw new AppError("UNAUTHENTICATED", 401);
  }

  if (isWeakPin(input.newPin)) throw new AppError("PIN_TOO_WEAK", 400);
  const pinHash = await hashSecret(input.newPin);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { pinHash, pinChangedAt: new Date(), failedPinAttempts: 0, lockoutLevel: 0, lockedUntil: null },
    });
    await revokeAllSessions(tx, user.id, "PIN_RESET");
    await tx.auditEvent.create({ data: { userId: user.id, type: "PIN_RESET" } });
  });
}