import type { ConsoleMember } from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { owedCovers } from "./memberService.js";
import { writeOffCovers } from "./reserveService.js";

// Protecting the group (D69): what the MFI officer does when a member dies,
// leaves a started group, or loses her number. The money never moves here:
// it stays in the group's account at the MFI (D2). These actions only change
// who it is sent to, and who may log in. Each is logged with the officer's
// name, and each is limited to the officer's own MFI (D52).

type Tx = Prisma.TransactionClient;

const PHONE = /^\+228\d{8}$/;

// Her seats in this MFI's groups, from the moment the group reached the MFI.
async function seatsAtMfi(userId: string, mfiId: string, db: Tx | typeof prisma = prisma) {
  return db.membership.findMany({
    where: {
      userId,
      state: "ACCEPTED",
      group: { mfiId, state: { in: ["STARTING", "ACTIVE", "COMPLETED"] } },
    },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          state: true,
          organiserId: true,
          rounds: { where: { beneficiaryId: userId }, select: { payout: { select: { status: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function memberView(userId: string, mfiId: string): Promise<ConsoleMember> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const seats = await seatsAtMfi(userId, mfiId);
  return {
    userId,
    legalName: user.legalName,
    phone: user.phone,
    closed: user.closedAt !== null,
    nextOfKin:
      user.nextOfKinName && user.nextOfKinPhone
        ? { name: user.nextOfKinName, phone: user.nextOfKinPhone, relation: user.nextOfKinRelation ?? "" }
        : null,
    owedFcfa: await owedCovers(userId),
    seats: seats.map((seat) => ({
      groupId: seat.group.id,
      groupName: seat.group.name,
      groupState: seat.group.state as "STARTING" | "ACTIVE" | "COMPLETED",
      role: seat.group.organiserId === userId ? "ORGANISER" : "MEMBER",
      payoutPosition: seat.payoutPosition,
      potReceived: seat.group.rounds.some((r) => r.payout?.status === "PAID"),
      exitReason: seat.exitReason,
      exitedAt: seat.exitedAt?.toISOString() ?? null,
      exitPayoutPhone: seat.exitPayoutPhone,
    })),
  };
}

// A member whose phone is given at the counter. She must hold a seat at this
// MFI; anyone else is answered as unknown, so a lookup reveals nothing about
// members of other MFIs, or people without Novi.
export async function lookupMember(mfiId: string, staffId: string, phone: string): Promise<ConsoleMember> {
  if (!PHONE.test(phone)) throw new AppError("VALIDATION_FAILED", 400);
  const user = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (!user || (await seatsAtMfi(user.id, mfiId)).length === 0) throw new AppError("NOT_FOUND", 404);
  await prisma.auditEvent.create({ data: { type: "STAFF_MEMBER_LOOKUP", details: { staffId, userId: user.id } } });
  return memberView(user.id, mfiId);
}

async function memberAtMfi(mfiId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || (await seatsAtMfi(userId, mfiId)).length === 0) throw new AppError("NOT_FOUND", 404);
  return user;
}

// When the organiser goes, the role passes to the next member in the turn
// order, so the group always has someone to speak for it. The officer can
// choose another with changeOrganiser.
async function handOver(tx: Tx, groupId: string, leavingId: string): Promise<string | null> {
  const next = await tx.membership.findFirst({
    where: { groupId, state: "ACCEPTED", exitReason: null, userId: { not: leavingId } },
    orderBy: [{ payoutPosition: "asc" }, { createdAt: "asc" }],
  });
  if (!next) return null;
  await tx.group.update({ where: { id: groupId }, data: { organiserId: next.userId } });
  await tx.membership.updateMany({ where: { groupId, userId: leavingId }, data: { role: "MEMBER" } });
  await tx.membership.update({ where: { id: next.id }, data: { role: "ORGANISER" } });
  return next.userId;
}

// Records that she died, or left a started group, on the officer's word.
//
// DEATH (on a death certificate): applies to all her running groups at this
// MFI. Her account is closed and logged out everywhere. What the fund paid
// for her is written off, and the fund pays her remaining shares; nobody
// owes them. Her pot, at her turn, and her part of the reserve go to her
// next of kin's number, or the one the officer gives.
//
// LEFT: only that group. She still owes what the fund pays for her; it is
// taken from her pot first if her turn has not come, otherwise it stays a
// debt that stops her joining another group, which the MFI recovers.
export async function recordExit(
  mfiId: string,
  staffId: string,
  userId: string,
  input: { groupId: string; reason: "DEATH" | "LEFT"; payoutPhone?: string },
  now = new Date(),
): Promise<ConsoleMember> {
  const user = await memberAtMfi(mfiId, userId);
  if (input.payoutPhone && !PHONE.test(input.payoutPhone)) throw new AppError("VALIDATION_FAILED", 400);

  const seats = (await seatsAtMfi(userId, mfiId)).filter((s) => s.group.state !== "COMPLETED" && !s.exitReason);
  const chosen = seats.find((s) => s.group.id === input.groupId);
  if (!chosen) throw new AppError("NOT_ALLOWED_NOW", 409);
  if (chosen.group.state !== "ACTIVE") throw new AppError("NOT_ALLOWED_NOW", 409);

  let payoutPhone: string | null;
  if (input.reason === "DEATH") {
    payoutPhone = input.payoutPhone ?? user.nextOfKinPhone;
    if (!payoutPhone) throw new AppError("NEXT_OF_KIN_MISSING", 409);
  } else {
    payoutPhone = input.payoutPhone ?? null; // null: her own number
  }
  const affected = input.reason === "DEATH" ? seats.filter((s) => s.group.state === "ACTIVE") : [chosen];

  await prisma.$transaction(async (tx) => {
    for (const seat of affected) {
      await tx.membership.update({
        where: { id: seat.id },
        data: { exitReason: input.reason, exitedAt: now, exitPayoutPhone: payoutPhone },
      });
      let writtenOff = 0;
      if (input.reason === "DEATH") writtenOff = await writeOffCovers(tx, seat.group.id, userId, now);
      const newOrganiser = seat.group.organiserId === userId ? await handOver(tx, seat.group.id, userId) : null;
      // Not yet sent pots of hers in this group follow the new number.
      await tx.payout.updateMany({
        where: { beneficiaryId: userId, round: { groupId: seat.group.id }, status: { in: ["HELD", "READY"] } },
        data: { phone: payoutPhone ?? user.phone, toNextOfKin: input.reason === "DEATH" },
      });
      await tx.auditEvent.create({
        data: {
          type: "STAFF_MEMBER_EXIT",
          details: {
            staffId,
            userId,
            groupId: seat.group.id,
            reason: input.reason,
            coversWrittenOff: writtenOff,
            newOrganiser,
          },
        },
      });
    }
    if (input.reason === "DEATH") {
      await tx.user.update({ where: { id: userId }, data: { closedAt: now } });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: "DECEASED" },
      });
    }
  });
  return memberView(userId, mfiId);
}

// Her phone was lost or stolen and she has a new SIM. She comes to the
// agency with her ID; the officer checks it and records the new number.
// Every session is closed and every phone untrusted, so whoever holds the
// old phone is logged out, and she logs in again with the SMS code sent to
// the new number and her PIN. Her pots not yet sent follow the new number.
export async function changePhone(
  mfiId: string,
  staffId: string,
  userId: string,
  phone: string,
  now = new Date(),
): Promise<ConsoleMember> {
  if (!PHONE.test(phone)) throw new AppError("VALIDATION_FAILED", 400);
  const user = await memberAtMfi(mfiId, userId);
  if (user.closedAt) throw new AppError("NOT_ALLOWED_NOW", 409);
  if (user.phone === phone) throw new AppError("VALIDATION_FAILED", 400);
  if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
    throw new AppError("PHONE_ALREADY_REGISTERED", 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { phone } });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: "PHONE_CHANGED" },
    });
    await tx.device.updateMany({ where: { userId, untrustedAt: null }, data: { untrustedAt: now } });
    await tx.payout.updateMany({
      where: { beneficiaryId: userId, phone: user.phone, status: { in: ["HELD", "READY", "FAILED"] } },
      data: { phone },
    });
    // The old and new numbers are not written to the log, only that it changed.
    await tx.auditEvent.create({ data: { userId, type: "STAFF_PHONE_CHANGED", details: { staffId, userId } } });
  });
  return memberView(userId, mfiId);
}

// The officer names a new organiser: when the organiser asks to hand over,
// or after the automatic handover chose someone the group does not want.
export async function changeOrganiser(
  mfiId: string,
  staffId: string,
  groupId: string,
  userId: string,
): Promise<ConsoleMember> {
  const group = await prisma.group.findFirst({
    where: { id: groupId, mfiId, state: { in: ["STARTING", "ACTIVE"] } },
  });
  if (!group) throw new AppError("NOT_FOUND", 404);
  const seat = await prisma.membership.findFirst({
    where: { groupId, userId, state: "ACCEPTED", exitReason: null },
  });
  if (!seat) throw new AppError("NOT_ALLOWED_NOW", 409);
  if (group.organiserId !== userId) {
    await prisma.$transaction([
      prisma.membership.updateMany({ where: { groupId, userId: group.organiserId }, data: { role: "MEMBER" } }),
      prisma.membership.update({ where: { id: seat.id }, data: { role: "ORGANISER" } }),
      prisma.group.update({ where: { id: groupId }, data: { organiserId: userId } }),
      prisma.auditEvent.create({
        data: {
          type: "STAFF_ORGANISER_CHANGED",
          details: { staffId, groupId, from: group.organiserId, to: userId },
        },
      }),
    ]);
  }
  return memberView(userId, mfiId);
}
