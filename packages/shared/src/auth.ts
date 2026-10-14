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