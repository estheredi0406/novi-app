// What the app receives after signing up or logging in.
export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
};

// The member as the app shows her. The legal name appears on the ACEV;
// the display name is what her group sees.
export type MemberProfile = {
  id: string;
  displayName: string;
  legalName: string;
  language: "EN" | "FR" | "EE";
  area: string;
  market: string | null;
};

export type AuthResponse = { tokens: AuthTokens; member: MemberProfile };

// Answers of the sign-up steps that come before the account exists.
// pilotCode: only in the online pilot (D61), the code that was "sent" by SMS.
export type OtpChallenge = { challengeId: string; expiresInSec: number; resendInSec: number; pilotCode?: string };
export type PhoneVerification = { verificationToken: string; expiresInSec: number };
export type IdentityStarted = { pendingToken: string; maskedPhone: string; expiresInSec: number; pilotCode?: string };
export type IdentityConfirmed = { identityToken: string; legalName: string; expiresInSec: number };