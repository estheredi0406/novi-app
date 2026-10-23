import { jwtVerify, SignJWT } from "jose";
import { config } from "./config.js";

const secret = new TextEncoder().encode(config.jwtSecret);
const ISSUER = "novi-api";
const AUDIENCE = "novi-access";

// Who is asking: the member and the session the token belongs to.
export type AccessClaims = { userId: string; sessionId: string };

// Access token: shown on every request, valid for 15 minutes. If stolen,
// it stops working on its own; the session's refresh token is what renews it.
export async function createAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

// Returns the claims if the token is genuine, unaltered and unexpired; otherwise null.
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
} 


// Which step of a flow a step token proves was completed.
export type StepPurpose = "SIGN_UP" | "PIN_RESET" | "NEW_DEVICE" | "IDENTITY_PENDING" | "IDENTITY_VERIFIED";

// Short-lived proof that one step was completed, e.g. "this phone number was
// confirmed by SMS for sign-up". Each purpose gets its own audience, so a token
// earned in one flow cannot be used in another, and none can pass as an access
// token. Extra claims carry what the next step needs; they are signed, so they
// cannot be altered, but they are readable, so they never hold a raw secret.
export async function createStepToken(
  purpose: StepPurpose,
  subject: string,
  minutes = 10,
  claims: Record<string, string> = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(`novi-step-${purpose}`)
    .setIssuedAt()
    .setExpirationTime(`${minutes}m`)
    .sign(secret);
}

export type StepToken = { subject: string; claims: Record<string, unknown> };

// Returns the token's subject and claims if it is genuine, unexpired and was
// issued for this purpose; otherwise null.
export async function verifyStepToken(token: string, purpose: StepPurpose): Promise<StepToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: `novi-step-${purpose}` });
    if (typeof payload.sub !== "string") return null;
    return { subject: payload.sub, claims: payload };
  } catch {
    return null;
  }
}
// ---------- MFI staff (Sprint 5) ----------

const STAFF_AUDIENCE = "novi-staff";

export type StaffClaims = { staffId: string; sessionId: string };

// A console token: its own audience, so a staff token can never be used on a
// member route, nor a member token on the console (D52). It lasts a working
// day; the session row lets logout end it earlier.
export async function createStaffToken(claims: StaffClaims, expiresAt: Date): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.staffId)
    .setIssuer(ISSUER)
    .setAudience(STAFF_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret);
}

export async function verifyStaffToken(token: string): Promise<StaffClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: STAFF_AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { staffId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}
