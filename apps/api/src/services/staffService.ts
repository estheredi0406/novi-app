import type { StaffCredentials, StaffLoginResponse, StaffMember, StaffProfile, StaffRole } from "@novi/shared";
import { randomInt } from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { hashSecret, verifySecret } from "../lib/hashing.js";
import { createStaffToken } from "../lib/tokens.js";
import { checkTotp, newTotpSecret, otpauthUri } from "../lib/totp.js";

// MFI staff accounts and console login (Sprint 5, D52).

const SESSION_HOURS = 8; // a working day at the agency
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

type StaffWithMfi = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  mustChangePassword: boolean;
  mfi: { code: string; name: string };
};

function profile(staff: StaffWithMfi): StaffProfile {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    mfi: { code: staff.mfi.code, name: staff.mfi.name },
    mustChangePassword: staff.mustChangePassword,
  };
}

// A temporary password that is easy to read out and type: four groups of
// four letters and digits, without look-alikes (0/o, 1/l). About 80 bits.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}

export const MIN_PASSWORD = 12;

// Creates a staff account for an MFI. The staff:create script uses it once,
// for the MFI's first administrator; after that, administrators add their
// officers in the console (D81). Returns the temporary password and the
// authenticator secret, shown once and never again. The temporary password
// must be replaced at the first login.
export async function createStaff(input: { mfiCode: string; email: string; name: string; role?: StaffRole }) {
  const mfi = await prisma.mfi.findUnique({ where: { code: input.mfiCode } });
  if (!mfi) throw new Error(`No MFI with code ${input.mfiCode}.`);

  const password = temporaryPassword();
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
      mustChangePassword: true,
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
  // A deactivated officer gets the same answer as a wrong password (D81).
  if (!staff || staff.deactivatedAt) {
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

// ---------- Changing one's own password (D81) ----------

// At the first login the temporary password must be replaced; any time
// after, an officer can change it. The other sessions are closed, in case
// the old password was seen by someone.
export async function changePassword(staffId: string, sessionId: string, current: string, next: string): Promise<StaffProfile> {
  const staff = await prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } });
  if (!(await verifySecret(staff.passwordHash, current))) throw new AppError("STAFF_LOGIN_FAILED", 401);
  if (next.length < MIN_PASSWORD || next === current) throw new AppError("WEAK_PASSWORD", 400);
  await prisma.staffUser.update({
    where: { id: staffId },
    data: { passwordHash: await hashSecret(next), mustChangePassword: false },
  });
  await prisma.staffSession.updateMany({
    where: { staffId, id: { not: sessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.auditEvent.create({ data: { type: "STAFF_PASSWORD_CHANGED", details: { staffId } } });
  return getStaffProfile(staffId);
}

// ---------- The MFI's team, managed by its administrators (D81) ----------

type Actor = { staffId: string; mfiId: string; role: StaffRole };

function adminOnly(actor: Actor) {
  if (actor.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
}

function toMember(s: { id: string; name: string; email: string; role: StaffRole; mustChangePassword: boolean; deactivatedAt: Date | null; lastLoginAt: Date | null }, actor: Actor): StaffMember {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    role: s.role,
    state: s.deactivatedAt ? "DISABLED" : s.mustChangePassword ? "FIRST_LOGIN" : "ACTIVE",
    lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
    isYou: s.id === actor.staffId,
  };
}

async function credentials(member: StaffMember, password: string, totpSecret: string): Promise<StaffCredentials> {
  const qrSvg = await QRCode.toString(otpauthUri(member.email, totpSecret), { type: "svg", margin: 1, width: 200 });
  return { member, password, qrSvg, setupKey: totpSecret };
}

// One of this MFI's officers, or NOT_FOUND: an administrator never reaches
// another MFI's staff.
async function teammate(actor: Actor, staffId: string) {
  const s = await prisma.staffUser.findFirst({ where: { id: staffId, mfiId: actor.mfiId } });
  if (!s) throw new AppError("NOT_FOUND", 404);
  return s;
}

const audit = (actor: Actor, type: string, target: { id: string; name: string }) =>
  prisma.auditEvent.create({ data: { type, details: { staffId: actor.staffId, targetId: target.id, reason: target.name } } });

export async function listTeam(actor: Actor): Promise<StaffMember[]> {
  adminOnly(actor);
  const team = await prisma.staffUser.findMany({ where: { mfiId: actor.mfiId }, orderBy: [{ deactivatedAt: "asc" }, { name: "asc" }] });
  return team.map((s) => toMember(s, actor));
}

export async function addOfficer(actor: Actor, input: { name: string; email: string; role: StaffRole }): Promise<StaffCredentials> {
  adminOnly(actor);
  const email = input.email.trim().toLowerCase();
  if (await prisma.staffUser.findUnique({ where: { email } })) throw new AppError("STAFF_EMAIL_TAKEN", 409);
  const password = temporaryPassword();
  const totpSecret = newTotpSecret();
  const created = await prisma.staffUser.create({
    data: {
      mfiId: actor.mfiId,
      email,
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashSecret(password),
      totpSecret,
      mustChangePassword: true,
    },
  });
  await audit(actor, "STAFF_ADDED", created);
  return credentials(toMember(created, actor), password, totpSecret);
}

// Closes every session at once: the officer is out the moment she leaves.
// An administrator cannot deactivate herself, nor the last active one.
export async function deactivateOfficer(actor: Actor, staffId: string): Promise<StaffMember> {
  adminOnly(actor);
  const target = await teammate(actor, staffId);
  if (target.id === actor.staffId) throw new AppError("NOT_ALLOWED_NOW", 409);
  if (target.role === "ADMIN") {
    const admins = await prisma.staffUser.count({ where: { mfiId: actor.mfiId, role: "ADMIN", deactivatedAt: null } });
    if (admins <= 1) throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  const now = new Date();
  const updated = await prisma.staffUser.update({ where: { id: staffId }, data: { deactivatedAt: target.deactivatedAt ?? now } });
  await prisma.staffSession.updateMany({ where: { staffId, revokedAt: null }, data: { revokedAt: now } });
  await audit(actor, "STAFF_DEACTIVATED", target);
  return toMember(updated, actor);
}

export async function reactivateOfficer(actor: Actor, staffId: string): Promise<StaffMember> {
  adminOnly(actor);
  const target = await teammate(actor, staffId);
  const updated = await prisma.staffUser.update({ where: { id: staffId }, data: { deactivatedAt: null, failedAttempts: 0, lockedUntil: null } });
  await audit(actor, "STAFF_REACTIVATED", target);
  return toMember(updated, actor);
}

// A lost phone or a forgotten password: a new temporary password and a new
// authenticator key, and every session closed. The old phone's codes stop
// working at once.
export async function resetAccess(actor: Actor, staffId: string): Promise<StaffCredentials> {
  adminOnly(actor);
  const target = await teammate(actor, staffId);
  if (target.id === actor.staffId) throw new AppError("NOT_ALLOWED_NOW", 409);
  const password = temporaryPassword();
  const totpSecret = newTotpSecret();
  const updated = await prisma.staffUser.update({
    where: { id: staffId },
    data: {
      passwordHash: await hashSecret(password),
      totpSecret,
      lastTotpStep: null,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  await prisma.staffSession.updateMany({ where: { staffId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(actor, "STAFF_ACCESS_RESET", target);
  return credentials(toMember(updated, actor), password, totpSecret);
}
