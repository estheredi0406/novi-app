// Setting the order of turns, starting the group and opening its account at the MFI.

import type { GroupDetail } from "@novi/shared";
import { Prisma } from "../../generated/prisma/client.js";
import type { Frequency } from "../../generated/prisma/enums.js";
import { prisma } from "../../lib/db.js";
import { enforce } from "../../lib/enforce.js";
import { AppError } from "../../lib/errors.js";
import {
  checkCanStartAnother,
  checkFixedOrder,
  checkReadyToStart,
  holdsSeat,
  guardTurnOne,
} from "../../lib/groupRules.js";
import { drawOrder } from "../../lib/payoutOrder.js";
import { dueDates } from "../../lib/schedule.js";
import { carryChoices } from "../savingsService.js";
import { mfi } from "../../providers/index.js";
import { alertStaff } from "../alertService.js";
import { notifyGroupStatus } from "../notifyService.js";
import { authorise, currentRules, saveNextVersion } from "./shared.js";
import type { LoadedGroup } from "./shared.js";
import { getGroup } from "./reading.js";

// The organiser sets the order of turns (D41), for example Abla first because
// her rent is due. It makes a new version of the rules, so everyone accepts
// it before the start (D29).
export async function setPayoutOrder(
  groupId: string,
  userId: string,
  memberIds: string[],
): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "SET_ORDER");
  const rules = currentRules(group);
  const holders = group.memberships
    .filter(holdsSeat)
    .map((seat) => seat.userId);
  if (holders.length !== rules.size)
    enforce({ ok: false, reason: "SEATS_NOT_FILLED" });
  enforce(checkFixedOrder(memberIds, holders));

  const { amountFcfa, frequency, dueDay, size } = rules;
  await saveNextVersion(
    group,
    userId,
    {
      amountFcfa,
      frequency,
      dueDay,
      size,
      payoutOrder: "FIXED",
      fixedOrder: memberIds,
      mfiId: rules.mfiId,
    },
    "GROUP_ORDER_SET",
  );
  return getGroup(groupId, userId);
}

// How many groups she has started (D27), not counting the group given.
async function countStarts(
  userId: string,
  exceptGroupId: string,
): Promise<number> {
  return prisma.group.count({
    where: {
      organiserId: userId,
      id: { not: exceptGroupId },
      state: { in: ["STARTING", "ACTIVE", "COMPLETED"] },
    },
  });
}

// Has she kept paying until the end of a whole cycle in some group (D27)?
async function hasCompletedCycle(userId: string): Promise<boolean> {
  const seats = await prisma.membership.count({
    where: { userId, state: "ACCEPTED", group: { state: "COMPLETED" } },
  });
  return seats > 0;
}

// Starts the group: check the rules, fix the order, then ask the MFI to open
// the account. If the MFI does not answer, the order is kept and never drawn
// again, so nobody can retry until the draw suits them.
export async function startGroup(
  groupId: string,
  userId: string,
): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "START");
  const wasProposed = group.state === "PROPOSED";
  if (wasProposed) await fixOrder(group, userId);
  // D66: when the MFI validates groups itself, the group waits in STARTING
  // until an officer approves it in the console; only then is the account
  // opened. Otherwise Novi asks the MFI straight away.
  if (!mfiValidatesGroups()) await openAccount(groupId, userId);
  else if (wasProposed) {
    // D152: the other members learn it too, not only the organiser.
    await notifyGroupStatus(groupId, "CHECKING", userId);
    // D90: the officers hear about it without watching the console.
    await alertStaff({
      mfiId: group.mfiId,
      kind: "GROUP_TO_VALIDATE",
      refId: groupId,
      groupId,
      subject: `Groupe à valider : ${group.name}`,
      lines: [
        `Le groupe « ${group.name} » a démarré côté membres et attend votre validation.`,
        "Ses membres et leur historique Novi sont sur sa page.",
      ],
    });
  }
  return getGroup(groupId, userId);
}

// D66: set per deployment while there is one partner MFI.
export function mfiValidatesGroups(): boolean {
  return process.env.MFI_GROUP_APPROVAL === "true";
}

// D66: an officer approved the group; the MFI opens its account and the
// calendar starts. Refused unless the group is waiting in STARTING.
export async function openApprovedGroup(groupId: string): Promise<void> {
  await openAccount(groupId, null);
}

async function fixOrder(group: LoadedGroup, userId: string) {
  const rules = currentRules(group);
  const seats = group.memberships.filter(holdsSeat);
  enforce(checkReadyToStart(seats, rules.size, group.currentVersion));
  enforce(
    checkCanStartAnother(
      await countStarts(userId, group.id),
      await hasCompletedCycle(userId),
    ),
  );

  const holders = seats.map((seat) => seat.userId);
  if (rules.payoutOrder === "FIXED")
    enforce(checkFixedOrder(rules.fixedOrder, holders));
  const chosen =
    rules.payoutOrder === "FIXED" ? rules.fixedOrder : drawOrder(holders);
  // D104: turn 1 goes to a member with a Novi history (a completed cycle),
  // or else to the organiser, who vouches for the members she invited.
  const withHistory = new Set<string>();
  for (const id of holders) if (await hasCompletedCycle(id)) withHistory.add(id);
  const order = guardTurnOne(chosen, withHistory, group.organiserId);
  if (rules.payoutOrder === "FIXED" && order[0] !== chosen[0])
    throw new AppError("TURN_ONE_NEEDS_HISTORY", 400);

  await prisma.$transaction(async (tx) => {
    // Only a group still PROPOSED moves on, so two taps on "Start" at the
    // same moment cannot draw two orders.
    const moved = await tx.group.updateMany({
      where: { id: group.id, state: "PROPOSED" },
      data: { state: "STARTING" },
    });
    if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
    for (const [index, memberId] of order.entries()) {
      await tx.membership.update({
        where: { groupId_userId: { groupId: group.id, userId: memberId } },
        data: { payoutPosition: index + 1 },
      });
    }
    const details: Prisma.InputJsonObject = {
      groupId: group.id,
      version: group.currentVersion,
      payoutOrder: rules.payoutOrder,
      order,
    };
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_STARTING", details },
    });
  });
}

// Asks the MFI to open the account. The MFI is told group totals only: no
// names, no phone numbers (D33).
async function openAccount(groupId: string, userId: string | null) {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { rulesVersions: true },
  });
  const rules = currentRules(group);

  let accountRef: string;
  try {
    ({ accountRef } = await mfi.openGroupAccount({
      groupId,
      contributionFcfa: rules.amountFcfa,
      members: rules.size,
      frequency: rules.frequency,
    }));
  } catch (err) {
    console.error(`MFI could not open the account for group ${groupId}:`, err);
    await prisma.auditEvent.create({
      data: { userId, type: "GROUP_MFI_FAILED", details: { groupId } },
    });
    throw new AppError("MFI_UNAVAILABLE", 503);
  }

  const startedAt = new Date();
  let started = false;
  await prisma.$transaction(async (tx) => {
    const moved = await tx.group.updateMany({
      where: { id: groupId, state: "STARTING" },
      data: { state: "ACTIVE", mfiAccountRef: accountRef, startedAt },
    });
    // The calendar is written once, by the request that made the group ACTIVE.
    if (moved.count === 1) {
      started = true;
      await createRounds(tx, groupId, startedAt, rules);
      await carryChoices(tx, groupId); // D147: choices made before the start
    }
    await tx.auditEvent.create({
      data: { userId, type: "GROUP_ACTIVE", details: { groupId } },
    });
  });
  if (started) await notifyGroupStatus(groupId, "STARTED"); // D152
}

// Writes the group's calendar: one round per member, round N due
// on the Nth due day after the start (D44), and paid out to the member whose
// payout position is N.
async function createRounds(
  tx: Prisma.TransactionClient,
  groupId: string,
  startedAt: Date,
  rules: { frequency: Frequency; dueDay: number; size: number },
) {
  const seats = await tx.membership.findMany({
    where: { groupId, payoutPosition: { not: null } },
    orderBy: { payoutPosition: "asc" },
  });
  const dates = dueDates(
    startedAt,
    rules.frequency,
    rules.dueDay,
    seats.length,
  );
  await tx.round.createMany({
    data: seats.map((seat, i) => ({
      groupId,
      number: i + 1,
      dueDate: dates.at(i) as Date,
      beneficiaryId: seat.userId,
    })),
  });
}
