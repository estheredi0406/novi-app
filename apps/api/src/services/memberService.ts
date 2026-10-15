import type { MemberProfile } from "@novi/shared";
import type { Language } from "../generated/prisma/client.js";
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
  changes: { displayName?: string; area?: string; market?: string | null; language?: Language },
): Promise<MemberProfile> {
  const user = await prisma.user.update({ where: { id: userId }, data: changes });
  return toMemberProfile(user);
}