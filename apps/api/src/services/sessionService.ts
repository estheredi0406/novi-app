import type { Prisma } from "../generated/prisma/client.js";
import { hashToken, newRandomToken } from "../lib/hashing.js";
import { createAccessToken } from "../lib/tokens.js";

const REFRESH_TOKEN_DAYS = 30;
const ACCESS_TOKEN_SEC = 15 * 60;

// Opens a session on a trusted device and returns its two tokens. Takes the
// database client as a parameter so it can run inside a caller's transaction.
export async function openSession(db: Prisma.TransactionClient, userId: string, deviceId: string) {
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