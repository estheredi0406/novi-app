import type { ErrorCode } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { niuKeyedHash } from "../lib/hashing.js";
import { createStepToken, verifyStepToken } from "../lib/tokens.js";
import { identity } from "../providers/index.js";
import type { IdentityConfirmed, IdentityStarted } from "@novi/shared";
import { pilotCode } from "../lib/pilot.js";
import { MockAnidProvider } from "../providers/identity/MockAnidProvider.js";

const MAX_FAILURES = 3;
const BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
const PENDING_MINUTES = 5; // matches the ANID code's lifetime
const IDENTITY_TOKEN_MINUTES = 15; // time left to choose a PIN and finish sign-up

// The phone confirmed by SMS for sign-up; every identity step requires it.
async function phoneFromSignUpToken(token: string): Promise<string> {
  const step = await verifyStepToken(token, "SIGN_UP");
  if (!step) throw new AppError("UNAUTHENTICATED", 401);
  return step.subject;
}

// Failed checks for this NIU in the last 24 hours, oldest first.
function recentFailures(niuHash: string) {
  return prisma.identityCheck.findMany({
    where: { niuKeyedHash: niuHash, matched: false, createdAt: { gte: new Date(Date.now() - BLOCK_WINDOW_MS) } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
}

// The block lifts 24 hours after the oldest of the recent failures.
function blocked(failures: { createdAt: Date }[]): AppError {
  const oldest = failures[0];
  const unblockAt = (oldest?.createdAt.getTime() ?? Date.now()) + BLOCK_WINDOW_MS;
  return new AppError("ID_BLOCKED", 429, Math.ceil((unblockAt - Date.now()) / 1000));
}

// Records a failed check, then blocks the NIU if this was the third in 24 hours (D12).
async function recordFailure(niuHash: string, phone: string, code: ErrorCode): Promise<never> {
  await prisma.identityCheck.create({ data: { niuKeyedHash: niuHash, phone, matched: false } });
  const failures = await recentFailures(niuHash);
  if (failures.length >= MAX_FAILURES) throw blocked(failures);
  throw new AppError(code, 400);
}

// Step 1: with her consent, asks ANID to match the details and send its code.
export async function startIdentityCheck(input: {
  verificationToken: string;
  consentToIdCheck: boolean;
  niu: string;
  legalName: string;
  dateOfBirth: string;
}) {
  const phone = await phoneFromSignUpToken(input.verificationToken);
  if (!input.consentToIdCheck) throw new AppError("CONSENT_REQUIRED", 400);

  const niuHash = niuKeyedHash(input.niu);
  const failures = await recentFailures(niuHash);
  if (failures.length >= MAX_FAILURES) throw blocked(failures);

  const legalName = input.legalName.trim().replace(/\s+/g, " ");
  const result = await identity.startVerification({
    niu: input.niu,
    fullName: legalName,
    dateOfBirth: input.dateOfBirth,
  });
  if (result.kind === "NO_MATCH") return recordFailure(niuHash, phone, "ID_MISMATCH");

  const pendingToken = await createStepToken("IDENTITY_PENDING", phone, PENDING_MINUTES, {
    tx: result.transactionId,
    niuHash,
    legalName,
    idConsentAt: new Date().toISOString(),
  });
  // Pilot mode (D61): the mock ANID keeps the code it "sent", to show it on screen.
  const sentCode = identity instanceof MockAnidProvider ? identity.sentCodes.get(result.transactionId) : undefined;
  return { pendingToken, maskedPhone: result.maskedPhone, expiresInSec: PENDING_MINUTES * 60, ...pilotCode(sentCode) };
}

// Step 2: checks the ANID code. On success, issues the proof that sign-up
// needs to create the account.
export async function confirmIdentityCheck(input: { verificationToken: string; pendingToken: string; code: string }) {
  const phone = await phoneFromSignUpToken(input.verificationToken);
  const pending = await verifyStepToken(input.pendingToken, "IDENTITY_PENDING");
  if (!pending || pending.subject !== phone) throw new AppError("ID_CODE_EXPIRED", 400);

  const { tx, niuHash, legalName, idConsentAt } = pending.claims;
  if (typeof tx !== "string" || typeof niuHash !== "string" || typeof legalName !== "string" || typeof idConsentAt !== "string") {
    throw new AppError("ID_CODE_EXPIRED", 400);
  }

  const result = await identity.confirmVerification(tx, input.code);
  if (result.kind === "CODE_INVALID") throw new AppError("ID_CODE_INVALID", 400);
  if (result.kind === "EXPIRED") return recordFailure(niuHash, phone, "ID_CODE_EXPIRED");

  await prisma.identityCheck.create({ data: { niuKeyedHash: niuHash, phone, matched: true } });

  // Only now, after ANID confirmed she owns this identity, may she learn
  // that it already has an account.
  const existing = await prisma.user.findUnique({ where: { niuKeyedHash: niuHash }, select: { id: true } });
  if (existing) throw new AppError("NIU_ALREADY_REGISTERED", 409);

  const identityToken = await createStepToken("IDENTITY_VERIFIED", phone, IDENTITY_TOKEN_MINUTES, {
    niuHash,
    legalName,
    idConsentAt,
    verifiedAt: new Date().toISOString(),
  });
  return { identityToken, legalName, expiresInSec: IDENTITY_TOKEN_MINUTES * 60 };
}