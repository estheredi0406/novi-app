// The MFI console (Sprint 5): shapes shared by the API and the console app.

export type StaffRole = "OFFICER" | "ADMIN";

// The logged-in staff member, as the console shows them.
export type StaffProfile = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  mfi: { code: string; name: string };
};

export type StaffLoginRequest = { email: string; password: string; code: string };

// A console session lasts a working day; there is no refresh token.
export type StaffLoginResponse = { accessToken: string; expiresAt: string; staff: StaffProfile };
