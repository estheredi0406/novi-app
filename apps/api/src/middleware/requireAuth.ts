import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { type AccessClaims, verifyAccessToken } from "../lib/tokens.js";

// Lets routes after requireAuth read who is asking from res.locals.auth.
declare global {
  namespace Express {
    interface Locals {
      auth?: AccessClaims;
    }
  }
}

// Runs before every member route: the request must carry a genuine, unexpired
// access token whose session is still active. Checking the session on every
// request is what makes logout and PIN reset take effect immediately.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) throw new AppError("UNAUTHENTICATED", 401);

  const claims = await verifyAccessToken(token);
  if (!claims) throw new AppError("UNAUTHENTICATED", 401);

  const session = await prisma.session.findUnique({
    where: { id: claims.sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.userId !== claims.userId || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError("SESSION_REVOKED", 401);
  }

  res.locals.auth = claims;
  next();
}

// The member making the request. Only valid in routes placed after requireAuth.
export function currentMember(res: Response): AccessClaims {
  const auth = res.locals.auth;
  if (!auth) throw new AppError("UNAUTHENTICATED", 401);
  return auth;
}