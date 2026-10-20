import type { GroupDetail, GroupSummary } from "@novi/shared";
import type { Frequency, PayoutOrder } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import {
  checkAction,
  checkCanJoin,
  checkRules,
  countsTowardLimit,
  type GroupAction,
  holdsSeat,
  type RuleBreak,
  type RuleResult,
} from "../lib/groupRules.js";

// The demo works with one partner MFI (brief, section 3). It is created the
// first time a group needs it; with several MFIs, the organiser will choose.
const PARTNER_MFI = { code: "FUCEC", name: "FUCEC-Togo" };

// How each refusal from the rules engine is answered: 400 the request itself
// is wrong, 403 this person may not do it, 409 the group is not in a state
// that allows it.
const STATUS: Record<RuleBreak, number> = {
  NOT_ALLOWED_NOW: 409,
  ORGANISER_ONLY: 403,
  MEMBERS_ONLY: 403,
  SIZE_OUT_OF_RANGE: 400,
  AMOUNT_OUT_OF_RANGE: 400,
  DUE_DAY_OUT_OF_RANGE: 400,
  GROUP_FULL: 409,
  GROUP_LIMIT_REACHED: 409,
  START_LIMIT_REACHED: 409,
  SEATS_NOT_FILLED: 409,
  NOT_EVERYONE_ACCEPTED: 409,
};

// Turns a refusal from the rules engine into the API error with the same code.
function enforce(result: RuleResult): void {
  if (!result.ok) throw new AppError(result.reason, STATUS[result.reason]);
}

export type RulesInput = {
  amountFcfa: number;
  frequency: Frequency;
  dueDay: number;
  size: number;
  payoutOrder: PayoutOrder;
};

// ---------- Reading ----------

// Everything needed to show one group: its MFI, every version of its rules
// (the current one is picked below) and every seat with the holder's name.
const detailQuery = {
  mfi: true,
  rulesVersions: { orderBy: { version: "desc" as const } },
  memberships: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { displayName: true } } },
  },
};

// Loads a group for this member, or answers NOT_FOUND. A person with no seat
// in the group gets the same answer as for a group that does not exist, so
// nobody can find out which groups exist by guessing their IDs.
async function loadForMember(groupId: string, userId: string) {
  const group = await prisma.group.findUnique({ where: { id: groupId }, include: detailQuery });
  const mySeat = group?.memberships.find((seat) => seat.userId === userId);
  if (!group || !mySeat || !holdsSeat(mySeat)) throw new AppError("NOT_FOUND", 404);
  return { group, mySeat, isOrganiser: group.organiserId === userId };
}

type LoadedGroup = Awaited<ReturnType<typeof loadForMember>>["group"];

function toDetail(group: LoadedGroup, userId: string): GroupDetail {
  const rules = group.rulesVersions.find((v) => v.version === group.currentVersion);
  if (!rules) throw new Error(`group ${group.id} has no rules version ${group.currentVersion}`);
  return {
    id: group.id,
    name: group.name,
    state: group.state,
    mfiName: group.mfi.name,
    rules: {
      version: rules.version,
      amountFcfa: rules.amountFcfa,
      frequency: rules.frequency,
      dueDay: rules.dueDay,
      size: rules.size,
      payoutOrder: rules.payoutOrder,
    },
    seats: group.memberships.filter(holdsSeat).map((seat) => ({
      memberId: seat.userId,
      displayName: seat.user.displayName,
      role: seat.role,
      state: seat.state,
      acceptedCurrentRules: seat.state === "ACCEPTED" && seat.acceptedVersion === group.currentVersion,
      counterNote: seat.counterNote,
    })),
    myRole: group.organiserId === userId ? "ORGANISER" : "MEMBER",
  };
}

export async function getGroup(groupId: string, userId: string): Promise<GroupDetail> {
  const { group } = await loadForMember(groupId, userId);
  return toDetail(group, userId);
}

// Her groups, newest first: every group where she holds a seat.
export async function listMyGroups(userId: string): Promise<GroupSummary[]> {
  const seats = await prisma.membership.findMany({
    where: { userId, state: { notIn: ["DECLINED", "REMOVED"] } },
    orderBy: { createdAt: "desc" },
    include: { group: { include: detailQuery } },
  });
  return seats.map(({ group, state }) => {
    const detail = toDetail(group, userId);
    return {
      id: detail.id,
      name: detail.name,
      state: detail.state,
      mfiName: detail.mfiName,
      amountFcfa: detail.rules.amountFcfa,
      frequency: detail.rules.frequency,
      size: detail.rules.size,
      seatsHeld: detail.seats.length,
      myRole: detail.myRole,
      mySeatState: state,
    };
  });
}

// How many of her seats count towards the 3-group limit (D26), not counting
// the group given, so the check can ask "and with this one?".
export async function countActiveGroups(userId: string, exceptGroupId?: string): Promise<number> {
  const seats = await prisma.membership.findMany({
    where: { userId, groupId: exceptGroupId ? { not: exceptGroupId } : undefined },
    select: { state: true, acceptedVersion: true, group: { select: { state: true } } },
  });
  return seats.filter((seat) => countsTowardLimit(seat.group.state, seat)).length;
}

// ---------- Creating and changing ----------

// Creates a group as a DRAFT with version 1 of its rules. The organiser holds
// the first seat and has accepted her own rules; it counts towards her limit
// only once she proposes the group (D26).
export async function createGroup(userId: string, input: { name: string } & RulesInput): Promise<GroupDetail> {
  enforce(checkRules(input));
  const { name, ...rules } = input;

  const groupId = await prisma.$transaction(async (tx) => {
    const mfi = await tx.mfi.upsert({ where: { code: PARTNER_MFI.code }, create: PARTNER_MFI, update: {} });
    const group = await tx.group.create({
      data: { name, mfiId: mfi.id, organiserId: userId, currentVersion: 1 },
    });
    await tx.rulesVersion.create({ data: { groupId: group.id, version: 1, proposedById: userId, ...rules } });
    await tx.membership.create({
      data: { groupId: group.id, userId, role: "ORGANISER", state: "ACCEPTED", acceptedVersion: 1, respondedAt: new Date() },
    });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_CREATED", details: { groupId: group.id } } });
    return group.id;
  });
  return getGroup(groupId, userId);
}

// Loads the group and checks that this member may do this action now.
async function authorise(groupId: string, userId: string, action: GroupAction) {
  const loaded = await loadForMember(groupId, userId);
  enforce(checkAction(action, loaded.group.state, loaded.isOrganiser));
  return loaded;
}

// Changes the rules by creating the next version (D29). Every member's
// acceptance falls back to "not yet"; the organiser accepts the new version
// by proposing it. Earlier versions stay, as the record of what was agreed.
export async function reviseRules(groupId: string, userId: string, rules: RulesInput): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "EDIT_RULES");
  enforce(checkRules(rules));
  const version = group.currentVersion + 1;

  await prisma.$transaction(async (tx) => {
    await tx.rulesVersion.create({ data: { groupId, version, proposedById: userId, ...rules } });
    await tx.group.update({ where: { id: groupId }, data: { currentVersion: version } });
    await tx.membership.updateMany({
      where: { groupId, role: "MEMBER", state: { in: ["ACCEPTED", "COUNTERED"] } },
      data: { state: "INVITED", counterNote: null, respondedAt: null },
    });
    await tx.membership.updateMany({
      where: { groupId, role: "ORGANISER" },
      data: { state: "ACCEPTED", acceptedVersion: version, respondedAt: new Date() },
    });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_RULES_REVISED", details: { groupId, version } } });
  });
  return getGroup(groupId, userId);
}

// Sends the rules to the invited members. From now on the group counts
// towards the organiser's limit, so she must have room for it (D26).
export async function proposeGroup(groupId: string, userId: string): Promise<GroupDetail> {
  await authorise(groupId, userId, "PROPOSE");
  enforce(checkCanJoin(await countActiveGroups(userId, groupId)));

  await prisma.$transaction(async (tx) => {
    await tx.group.update({ where: { id: groupId }, data: { state: "PROPOSED" } });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_PROPOSED", details: { groupId } } });
  });
  return getGroup(groupId, userId);
}

// Stops a group before any money has moved. Its seats no longer count
// towards anyone's limit, because a cancelled group is not live (D26).
export async function cancelGroup(groupId: string, userId: string): Promise<GroupDetail> {
  await authorise(groupId, userId, "CANCEL");

  await prisma.$transaction(async (tx) => {
    await tx.group.update({ where: { id: groupId }, data: { state: "CANCELLED", cancelledAt: new Date() } });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_CANCELLED", details: { groupId } } });
  });
  return getGroup(groupId, userId);
}