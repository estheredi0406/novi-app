// The MFI console (Sprint 5): shapes shared by the API and the console app.

export type StaffRole = "OFFICER" | "ADMIN";

// The logged-in staff member, as the console shows them.
export type StaffProfile = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  mfi: { code: string; name: string };
  mustChangePassword: boolean; // D81: first login with a temporary password
  pilot: boolean; // D82: pilot mode, where the demo tools appear
};

export type StaffLoginRequest = { email: string; password: string; code: string };

// A console session lasts a working day; there is no refresh token.
export type StaffLoginResponse = { accessToken: string; expiresAt: string; staff: StaffProfile };

// D81: the MFI's team, as its administrators manage it in the console.
export type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  state: "ACTIVE" | "FIRST_LOGIN" | "DISABLED";
  lastLoginAt: string | null;
  isYou: boolean;
};

// Shown once, when an officer is added or their access is reset: the
// temporary password, and the authenticator key as a QR code and as text.
export type StaffCredentials = {
  member: StaffMember;
  password: string;
  qrSvg: string;
  setupKey: string;
};
