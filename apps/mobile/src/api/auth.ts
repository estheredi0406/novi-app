import type {
  AuthResponse,
  IdentityConfirmed,
  IdentityStarted,
  MemberProfile,
  OtpChallenge,
  PhoneVerification,
} from "@novi/shared";
import type { AppLanguage } from "../i18n";
import { getInstallationId } from "../lib/storage";
import { memberRequest, publicRequest } from "./client";

// The sign-up and login endpoints, typed with the shapes from @novi/shared.

export function requestCode(phone: string, purpose: "SIGN_UP" | "PIN_RESET", language: AppLanguage) {
  return publicRequest<OtpChallenge>("POST", "/v1/auth/otp", { phone, purpose, language });
}

export function verifyCode(challengeId: string, code: string) {
  return publicRequest<PhoneVerification>("POST", "/v1/auth/otp/verify", { challengeId, code });
}

export function startIdentityCheck(input: {
  verificationToken: string;
  consentToIdCheck: boolean;
  niu: string;
  legalName: string;
  dateOfBirth: string;
}) {
  return publicRequest<IdentityStarted>("POST", "/v1/auth/identity/start", input);
}

export function confirmIdentityCheck(verificationToken: string, pendingToken: string, code: string) {
  return publicRequest<IdentityConfirmed>("POST", "/v1/auth/identity/confirm", { verificationToken, pendingToken, code });
}

export async function register(input: {
  verificationToken: string;
  identityToken: string;
  pin: string;
  displayName: string;
  area: string;
  market: string | null;
  language: AppLanguage;
  acceptedTerms: boolean;
  acceptedCreditDataUse: boolean;
}) {
  return publicRequest<AuthResponse>("POST", "/v1/auth/register", { ...input, installationId: await getInstallationId() });
}

// A 409 NEW_DEVICE answer arrives as an ApiError carrying the challengeId.
export async function login(phone: string, pin: string) {
  return publicRequest<AuthResponse>("POST", "/v1/auth/login", { phone, pin, installationId: await getInstallationId() });
}

export async function trustDevice(verificationToken: string, pin: string) {
  return publicRequest<AuthResponse>("POST", "/v1/auth/devices/trust", {
    verificationToken,
    pin,
    installationId: await getInstallationId(),
  });
}

export function resetPin(verificationToken: string, newPin: string) {
  return publicRequest<void>("POST", "/v1/auth/pin/reset", { verificationToken, newPin });
}

export function getProfile() {
  return memberRequest<MemberProfile>("GET", "/v1/me");
}

// Changes what she may change about herself: display name, area, market,
// language. Never her legal name (D15).
export function updateProfile(changes: {
  language?: AppLanguage;
  displayName?: string;
  nextOfKin?: { name: string; relation: string; phone: string } | null;
  notifyChat?: boolean;
}) {
  return memberRequest<MemberProfile>("PATCH", "/v1/me", changes);
}

export function logout() {
  return memberRequest<void>("POST", "/v1/auth/logout");
}