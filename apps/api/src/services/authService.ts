import type { AuthResponse, MemberProfile } from "@novi/shared";
import type { Language, User } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { hashSecret } from "../lib/hashing.js";
import { isWeakPin } from "../lib/pinRules.js";
import { verifyStepToken } from "../lib/tokens.js";
import { openSession } from "./sessionService.js";

// Version of the consent texts shown at sign-up. A new text gets a new version,
// so the database always shows which wording each member agreed to.
const CONSENT_VERSION = "2026-10-14";

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
  if (typeof niuHash !== "string" || typeof legalName !== "string" ||
      typeof idConsentAt !== "string" || typeof verifiedAt !== "string") {
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