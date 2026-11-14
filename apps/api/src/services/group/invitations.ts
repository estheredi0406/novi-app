// Inviting members by phone number, and withdrawing an invitation or a seat.

import type { GroupDetail, Invitation } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { enforce } from "../../lib/enforce.js";
import { AppError } from "../../lib/errors.js";
import { checkCanInvite, holdsSeat } from "../../lib/groupRules.js";
import { inviteSms } from "../../lib/smsText.js";
import { mfi, sms } from "../../providers/index.js";
import { authorise, currentRules, detailQuery, pending, placesTaken, toRules } from "./shared.js";
import { getGroup } from "./reading.js";

// Invites a phone number. It works the same whether or not the number has a
// Novi account, and the answer to the organiser is the same either way: she
// sees a masked number until the person answers (D38).
export async function inviteToGroup(
  groupId: string,
  userId: string,
  phone: string,
): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "INVITE");
  const rules = currentRules(group);
  enforce(checkCanInvite(placesTaken(group), rules.size));

  // Refused for a number already waiting for an answer, or already holding a seat.
  const invitee = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, language: true },
  });
  const alreadySeated =
    invitee &&
    group.memberships.some(
      (seat) => seat.userId === invitee.id && holdsSeat(seat),
    );
  if (alreadySeated || group.invites.some((invite) => invite.phone === phone)) {
    throw new AppError("ALREADY_INVITED", 409);
  }

  const organiser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true, language: true },
  });
  await prisma.$transaction(async (tx) => {
    // An earlier invitation to this number that was withdrawn or answered is reused.
    await tx.invite.upsert({
      where: { groupId_phone: { groupId, phone } },
      create: { groupId, phone, invitedById: userId },
      update: {
        invitedById: userId,
        createdAt: new Date(),
        answeredAt: null,
        cancelledAt: null,
      },
    });
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_INVITE_SENT", details: { groupId } },
    });
  });

  await sms.send(
    phone,
    inviteSms(invitee?.language ?? organiser.language, {
      organiserName: organiser.displayName,
      groupName: group.name,
      amountFcfa: rules.amountFcfa,
      frequency: rules.frequency,
    }),
  );
  return getGroup(groupId, userId);
}

// Withdraws an invitation that has not been answered, freeing its place.
export async function cancelInvite(
  groupId: string,
  userId: string,
  inviteId: string,
): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "REMOVE_SEAT");
  if (!group.invites.some((invite) => invite.id === inviteId))
    throw new AppError("NOT_FOUND", 404);

  await prisma.$transaction(async (tx) => {
    await tx.invite.update({
      where: { id: inviteId },
      data: { cancelledAt: new Date() },
    });
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_INVITE_CANCELLED", details: { groupId } },
    });
  });
  return getGroup(groupId, userId);
}

// Removes a member's seat before the group starts. The organiser's own seat
// cannot be removed: cancelling the group is how she stops it.
export async function removeSeat(
  groupId: string,
  userId: string,
  memberId: string,
): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "REMOVE_SEAT");
  if (memberId === group.organiserId)
    throw new AppError("CANNOT_REMOVE_ORGANISER", 400);
  const seat = group.memberships.find(
    (s) => s.userId === memberId && holdsSeat(s),
  );
  if (!seat) throw new AppError("NOT_FOUND", 404);

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: seat.id },
      data: { state: "REMOVED", respondedAt: new Date() },
    });
    await tx.auditEvent.create({
      data: {
        userId,
        type: "GROUP_SEAT_REMOVED",
        details: { groupId, memberId },
      },
    });
  });
  return getGroup(groupId, userId);
}

// The invitations waiting for her answer, found by her verified phone number.
// A number invited before it had an account sees its invitations as soon as
// it signs up. Only groups still being set up or decided are shown.
export async function listMyInvitations(userId: string): Promise<Invitation[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { phone: true },
  });
  const invites = await prisma.invite.findMany({
    where: {
      phone: user.phone,
      ...pending,
      group: { state: { in: ["DRAFT", "PROPOSED"] } },
    },
    orderBy: { createdAt: "desc" },
    include: {
      group: {
        include: {
          ...detailQuery,
          organiser: { select: { displayName: true } },
        },
      },
    },
  });
  return invites.map(({ id, group }) => ({
    id,
    groupId: group.id,
    groupName: group.name,
    groupState: group.state,
    organiserName: group.organiser.displayName,
    mfiName: group.mfi.name,
    rules: toRules(group),
    seatsHeld: group.memberships.filter(holdsSeat).length,
  }));
}
