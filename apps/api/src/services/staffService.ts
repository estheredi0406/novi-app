import type { StaffLoginResponse, StaffProfile, StaffRole } from "@novi/shared";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { hashSecret, verifySecret } from "../lib/hashing.js";
import { createStaffToken } from "../lib/tokens.js";
import { checkTotp, newTotpSecret, otpauthUri } from "../lib/totp.js";

// MFI staff accounts and console login (Sprint 5, D52).

const SESSION_HOURS = 8; // a working day at the agency
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

type StaffWithMfi = { id: string; name: string; email: string; role: StaffRole; mfi: { code: string; name: string } };

function profile(staff: StaffWithMfi): StaffProfile {
  return { id: staff.id, name: staff.name, email: staff.email, role: staff.role, mfi: { code: staff.mfi.code, name: staff.mfi.name } };
}

// Creates a staff account for an MFI. Used by the staff:create script, not by
// a route: for now, accounts are opened by whoever runs Novi, on the MFI's
// request. Returns the one-time password and the authenticator secret, which
// are shown once and never again.
export async function createStaff(input: { mfiCode: string; email: string; name: string; role?: StaffRole }) {
  const mfi = await prisma.mfi.findUnique({ where: { code: input.mfiCode } });
  if (!mfi) throw new Error(`No MFI with code ${input.mfiCode}.`);

  const password = randomBytes(12).toString("base64url"); // 16 characters
  const totpSecret = newTotpSecret();
  const email = input.email.trim().toLowerCase();
  const staff = await prisma.staffUser.create({
    data: {
      mfiId: mfi.id,
      email,
      name: input.name.trim(),
      role: input.role ?? "OFFICER",
      passwordHash: await hashSecret(password),
      totpSecret,
    },
  });
  await prisma.auditEvent.create({ data: { type: "STAFF_CREATED", details: { staffId: staff.id, mfi: mfi.code } } });
  return { staffId: staff.id, password, totpSecret, otpauth: otpauthUri(email, totpSecret) };
}

// The same slow check runs for an unknown email, so the time taken does not
// reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;

// Logs a staff member in with all three proofs at once. Any wrong part gives
// the same STAFF_LOGIN_FAILED; 5 failures lock the account for 15 minutes.
export async function staffLogin(input: { email: string; password: string; code: string }, now = new Date()): Promise<StaffLoginResponse> {
  const staff = await prisma.staffUser.findUnique({ where: { email: input.email.trim().toLowerCase() }, include: { mfi: true } });
  if (!staff) {
    dummyHash ??= hashSecret("not-a-staff-password");
    await verifySecret(await dummyHash, input.password);
    throw new AppError("STAFF_LOGIN_FAILED", 401);
  }
  if (staff.lockedUntil && staff.lockedUntil > now) {
    throw new AppError("STAFF_LOCKED", 423, Math.ceil((staff.lockedUntil.getTime() - now.getTime()) / 1000));
  }

  const passwordOk = await verifySecret(staff.passwordHash, input.password);
  const step = passwordOk ? checkTotp(staff.totpSecret, input.code, now.getTime(), staff.lastTotpStep) : null;
  if (step === null) {
    const failed = staff.failedAttempts + 1;
    const lock = failed >= MAX_ATTEMPTS;
    await prisma.staffUser.update({
      where: { id: staff.id },
      data: lock
        ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) }
        : { failedAttempts: failed },
    });
    await prisma.auditEvent.create({ data: { type: lock ? "STAFF_LOCKED" : "STAFF_LOGIN_FAILED", details: { staffId: staff.id } } });
    if (lock) throw new AppError("STAFF_LOCKED", 423, LOCK_MINUTES * 60);
    throw new AppError("STAFF_LOGIN_FAILED", 401);
  }

  // The code's step is saved only if it is newer than the last one, so two
  // logins racing with the same code cannot both succeed.
  const claimed = await prisma.staffUser.updateMany({
    where: { id: staff.id, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
    data: { lastTotpStep: step, failedAttempts: 0, lockedUntil: null, lastLoginAt: now },
  });
  if (claimed.count === 0) throw new AppError("STAFF_LOGIN_FAILED", 401);

  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  const session = await prisma.staffSession.create({ data: { staffId: staff.id, expiresAt } });
  await prisma.auditEvent.create({ data: { type: "STAFF_LOGIN", details: { staffId: staff.id } } });
  return {
    accessToken: await createStaffToken({ staffId: staff.id, sessionId: session.id }, expiresAt),
    expiresAt: expiresAt.toISOString(),
    staff: profile(staff),
  };
}

export async function staffLogout(sessionId: string): Promise<void> {
  await prisma.staffSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function getStaffProfile(staffId: string): Promise<StaffProfile> {
  return profile(await prisma.staffUser.findUniqueOrThrow({ where: { id: staffId }, include: { mfi: true } }));
}
