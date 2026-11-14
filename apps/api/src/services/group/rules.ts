// Creating a group and changing its rules before it starts.

import type { GroupDetail } from "@novi/shared";
import { prisma } from "../../lib/db.js";
import { enforce } from "../../lib/enforce.js";
import { checkCanJoin, checkRules } from "../../lib/groupRules.js";
import { mfi } from "../../providers/index.js";
import { authorise, chooseMfi, currentRules, refuseIfOwing, saveNextVersion } from "./shared.js";
import type { RulesInput } from "./shared.js";
import { countActiveGroups, getGroup } from "./reading.js";

// Creates a group as a DRAFT with version 1 of its rules. The organiser holds
// the first seat and has accepted her own rules; it counts towards her limit
// only once she proposes the group (D26).
export async function createGroup(
  userId: string,
  input: { name: string } & RulesInput,
): Promise<GroupDetail> {
  enforce(checkRules(input));
  await refuseIfOwing(userId);
  const { name, mfiId, ...rules } = input;

  const groupId = await prisma.$transaction(async (tx) => {
    const mfi = await chooseMfi(tx, mfiId);
    const group = await tx.group.create({
      data: { name, mfiId: mfi.id, organiserId: userId, currentVersion: 1 },
    });
    await tx.rulesVersion.create({
      data: {
        groupId: group.id,
        version: 1,
        proposedById: userId,
        mfiId: mfi.id,
        ...rules,
      },
    });
    await tx.membership.create({
      data: {
        groupId: group.id,
        userId,
        role: "ORGANISER",
        state: "ACCEPTED",
        acceptedVersion: 1,
        respondedAt: new Date(),
      },
    });
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_CREATED", details: { groupId: group.id } },
    });
    return group.id;
  });
  return getGroup(groupId, userId);
}

// Changes the amount, frequency, day, size or payout order. A fixed order
// already set is kept while the group stays FIXED; if it no longer fits,
// the start refuses it (D41).
export async function reviseRules(
  groupId: string,
  userId: string,
  rules: RulesInput,
): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "EDIT_RULES");
  enforce(checkRules(rules));
  const current = currentRules(group);
  const fixedOrder = rules.payoutOrder === "FIXED" ? current.fixedOrder : [];
  const mfiId =
    rules.mfiId === undefined
      ? current.mfiId
      : (await chooseMfi(prisma, rules.mfiId)).id;
  await saveNextVersion(
    group,
    userId,
    { ...rules, fixedOrder, mfiId },
    "GROUP_RULES_REVISED",
  );
  return getGroup(groupId, userId);
}

// Sends the rules to the invited members. From now on the group counts
// towards the organiser's limit, so she must have room for it (D26).
export async function proposeGroup(
  groupId: string,
  userId: string,
  shareConsent = false,
): Promise<GroupDetail> {
  await authorise(groupId, userId, "PROPOSE");
  enforce(checkCanJoin(await countActiveGroups(userId, groupId)));

  await prisma.$transaction(async (tx) => {
    await tx.group.update({
      where: { id: groupId },
      data: { state: "PROPOSED" },
    });
    // D84: the organiser agrees for her own seat when she sends the rules.
    if (shareConsent) {
      await tx.membership.updateMany({
        where: { groupId, userId },
        data: { shareConsentAt: new Date() },
      });
    }
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_PROPOSED", details: { groupId } },
    });
  });
  return getGroup(groupId, userId);
}

// Stops a group before any money has moved. Its seats no longer count
// towards anyone's limit, because a cancelled group is not live (D26).
export async function cancelGroup(
  groupId: string,
  userId: string,
): Promise<GroupDetail> {
  await authorise(groupId, userId, "CANCEL");

  await prisma.$transaction(async (tx) => {
    await tx.group.update({
      where: { id: groupId },
      data: { state: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_CANCELLED", details: { groupId } },
    });
  });
  return getGroup(groupId, userId);
}
