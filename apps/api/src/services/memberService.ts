import type { MemberProfile } from "@novi/shared";
import type { Language, Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { toMemberProfile } from "./authService.js";

export async function getProfile(userId: string): Promise<MemberProfile> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND", 404);
  return toMemberProfile(user);
}

// Changes what a member may change herself. The legal name is not here:
// it changes only through a new identity check (D15).
export async function updateProfile(
  userId: string,
  changes: {
    displayName?: string;
    area?: string;
    market?: string | null;
    language?: Language;
    nextOfKin?: { name: string; phone: string; relation: string } | null;
    notifyChat?: boolean;
  },
): Promise<MemberProfile> {
  const { nextOfKin, ...rest } = changes;
  const data: Prisma.UserUpdateInput = { ...rest };
  if (nextOfKin !== undefined) {
    if (nextOfKin) {
      // Her own number would defeat the purpose: after a death, that phone
      // may be lost or in someone else's hands.
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
      if (me?.phone === nextOfKin.phone) throw new AppError("NEXT_OF_KIN_SELF", 400);
    }
    data.nextOfKinName = nextOfKin?.name ?? null;
    data.nextOfKinPhone = nextOfKin?.phone ?? null;
    data.nextOfKinRelation = nextOfKin?.relation ?? null;
  }
  const user = await prisma.user.update({ where: { id: userId }, data });
  if (nextOfKin !== undefined) {
    // Who she named is not logged, only that she changed it.
    await prisma.auditEvent.create({ data: { userId, type: nextOfKin ? "NEXT_OF_KIN_SET" : "NEXT_OF_KIN_REMOVED" } });
  }
  return toMemberProfile(user);
}

// D69: what the solidarity fund paid for her and she has not paid back.
// While anything is owed she cannot create or join another group.
export async function owedCovers(userId: string): Promise<number> {
  const open = await prisma.reserveCover.aggregate({
    where: { userId, repaidAt: null, writtenOffAt: null },
    _sum: { amountFcfa: true },
  });
  return open._sum.amountFcfa ?? 0;
}