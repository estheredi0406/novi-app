import type { AuthTokens } from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { hashToken, newRandomToken } from "../lib/hashing.js";
import { createAccessToken } from "../lib/tokens.js";

const REFRESH_TOKEN_DAYS = 30;
const ACCESS_TOKEN_SEC = 15 * 60;
// A retired refresh token reused within this time is treated as an app retry on
// a weak connection, not as theft (D19).
const REUSE_GRACE_SEC = 30;

export type RevokeReason = "ROTATED" | "LOGOUT" | "PIN_RESET" | "REUSE_DETECTED";

// Opens a session on a trusted device and returns its two tokens. Takes the
// database client as a parameter so it can run inside a caller's transaction.
export async function openSession(db: Prisma.TransactionClient, userId: string, deviceId: string): Promise<AuthTokens> {
  const refreshToken = newRandomToken();
  const session = await db.session.create({
    data: {
      userId,
      deviceId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  const accessToken = await createAccessToken({ userId, sessionId: session.id });
  return { accessToken, refreshToken, accessExpiresInSec: ACCESS_TOKEN_SEC };
}

// Closes every open session of a member, on every phone.
export async function revokeAllSessions(db: Prisma.TransactionClient, userId: string, reason: RevokeReason): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

// Swaps a refresh token for a new pair. Each refresh token works once: the old
// session is closed and a new one opened. A retired token reused later means a
// copy exists, so every session of that member is closed (D19).
export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) } });
  if (!session) throw new AppError("UNAUTHENTICATED", 401);

  if (session.revokedAt) {
    const secondsSinceRotation = (Date.now() - session.revokedAt.getTime()) / 1000;
    if (session.revokedReason === "ROTATED" && secondsSinceRotation > REUSE_GRACE_SEC) {
      await revokeAllSessions(prisma, session.userId, "REUSE_DETECTED");
      await prisma.auditEvent.create({
        data: { userId: session.userId, type: "REFRESH_TOKEN_REUSED", details: { sessionId: session.id } },
      });
    }
    throw new AppError("SESSION_REVOKED", 401);
  }
  if (session.expiresAt < new Date()) throw new AppError("SESSION_REVOKED", 401);

  return prisma.$transaction(async (tx) => {
    // Closes the old session only if still open, so two simultaneous refreshes
    // with the same token cannot both succeed.
    const { count } = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "ROTATED" },
    });
    if (count === 0) throw new AppError("SESSION_REVOKED", 401);
    return openSession(tx, session.userId, session.deviceId);
  });
}

// Closes the session the request came from. Other phones stay logged in.
export async function logout(userId: string, sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: "LOGOUT" },
  });
  await prisma.auditEvent.create({ data: { userId, type: "LOGOUT", details: { sessionId } } });
}