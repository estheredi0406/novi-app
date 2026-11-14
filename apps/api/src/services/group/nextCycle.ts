// Starting the next cycle of a finished group.

import type { GroupDetail } from "@novi/shared";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { currentRules, loadForMember } from "./shared.js";
import { createGroup } from "./rules.js";
import { inviteToGroup } from "./invitations.js";
import { getGroup } from "./reading.js";

// Next cycle in one step: a new group with the same rules, and an invitation
// to each member who finished. It starts as a draft and each member accepts
// again (D29). Members who left (D69) or said "Non, j'arrête" (D80) are not
// invited.
export async function startNextCycle(
  groupId: string,
  userId: string,
): Promise<GroupDetail> {
  const { group, isOrganiser } = await loadForMember(groupId, userId);
  if (!isOrganiser) throw new AppError("ORGANISER_ONLY", 403);
  if (group.state !== "COMPLETED" || group.nextCycle)
    throw new AppError("NOT_ALLOWED_NOW", 409);

  const rules = currentRules(group);
  const created = await createGroup(userId, {
    name: group.name,
    amountFcfa: rules.amountFcfa,
    frequency: rules.frequency,
    dueDay: rules.dueDay,
    size: rules.size,
    payoutOrder: rules.payoutOrder,
    mfiId: rules.mfiId, // the next cycle stays at the same MFI unless changed (D95)
  });
  try {
    await prisma.group.update({
      where: { id: created.id },
      data: { previousGroupId: groupId, cycleNumber: group.cycleNumber + 1 },
    });
  } catch (err) {
    // Another tap got there first: this copy is not needed.
    await prisma.group.update({
      where: { id: created.id },
      data: { state: "CANCELLED", cancelledAt: new Date() },
    });
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError("NOT_ALLOWED_NOW", 409);
    }
    throw err;
  }

  const returning = await prisma.membership.findMany({
    where: {
      groupId,
      userId: { not: userId },
      payoutPosition: { not: null },
      exitReason: null,
      user: { closedAt: null },
      OR: [{ continueAnswer: null }, { continueAnswer: true }],
    },
    orderBy: { payoutPosition: "asc" },
    include: { user: { select: { phone: true } } },
  });
  for (const seat of returning) {
    await inviteToGroup(created.id, userId, seat.user.phone);
  }
  await prisma.auditEvent.create({
    data: {
      userId,
      type: "GROUP_NEXT_CYCLE",
      details: { from: groupId, to: created.id, invited: returning.length },
    },
  });
  return getGroup(created.id, userId);
}
