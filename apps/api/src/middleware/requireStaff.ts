import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { type StaffClaims, verifyStaffToken } from "../lib/tokens.js";

// The console's version of requireAuth: the request must carry a staff token
// (never a member's) whose session is still open (D52). Routes after it read
// the staff member and their MFI from res.locals.staff.
export type StaffContext = StaffClaims & { mfiId: string; role: "OFFICER" | "ADMIN" };

declare global {
  namespace Express {
    interface Locals {
      staff?: StaffContext;
    }
  }
}

export async function requireStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) throw new AppError("UNAUTHENTICATED", 401);

  const claims = await verifyStaffToken(token);
  if (!claims) throw new AppError("STAFF_ONLY", 401);

  const session = await prisma.staffSession.findUnique({
    where: { id: claims.sessionId },
    select: {
      staffId: true,
      revokedAt: true,
      expiresAt: true,
      staff: { select: { mfiId: true, role: true, mustChangePassword: true, deactivatedAt: true } },
    },
  });
  if (
    !session ||
    session.staffId !== claims.staffId ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.staff.deactivatedAt
  ) {
    throw new AppError("SESSION_REVOKED", 401);
  }
  // D81: with a temporary password, only her profile, the password change
  // and logging out are open (all under /v1/staff); the console waits.
  if (session.staff.mustChangePassword && !req.originalUrl.startsWith("/v1/staff/")) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED", 403);
  }

  res.locals.staff = { ...claims, mfiId: session.staff.mfiId, role: session.staff.role };
  next();
}

export function currentStaff(res: Response): StaffContext {
  const staff = res.locals.staff;
  if (!staff) throw new AppError("UNAUTHENTICATED", 401);
  return staff;
}
