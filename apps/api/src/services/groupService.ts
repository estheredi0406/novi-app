import type { GroupDetail, GroupRules, GroupSummary, Invitation } from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import type { Frequency, PayoutOrder, SeatState } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import {
  checkAction,
  checkAnswersCurrentRules,
  checkCanInvite,
  checkCanJoin,
  checkCanStartAnother,
  checkFixedOrder,
  checkReadyToStart,
  checkRules,
  countsTowardLimit,
  type GroupAction,
  holdsSeat,
  type RuleBreak,
  type RuleResult,
  type Seat,
} from "../lib/groupRules.js";
import { drawOrder } from "../lib/payoutOrder.js";
import { inviteSms } from "../lib/smsText.js";
import { mfi, sms } from "../providers/index.js";

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
  RULES_CHANGED: 409,
  ORDER_INVALID: 400,
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

// An invitation still waiting for an answer: not answered, not withdrawn.
const pending = { answeredAt: null, cancelledAt: null };

// Everything needed to show one group: its MFI, every version of its rules
// (the current one is picked below), every seat with the holder's name, and
// the invitations not answered yet.
const detailQuery = {
  mfi: true,
  rulesVersions: { orderBy: { version: "desc" as const } },
  memberships: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { displayName: true } } },
  },
  invites: { where: pending, orderBy: { createdAt: "asc" as const } },
};

// "+22890123456" becomes "+228 90 •• •• 56": enough for the group to tell
// invitations apart, not enough to read the number.
function maskPhone(phone: string): string {
  const digits = phone.replace("+228", "");
  return `+228 ${digits.slice(0, 2)} •• •• ${digits.slice(6)}`;
}

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

// The rules version in force now.
function currentRules(group: Pick<LoadedGroup, "id" | "currentVersion" | "rulesVersions">) {
  const rules = group.rulesVersions.find((v) => v.version === group.currentVersion);
  if (!rules) throw new Error(`group ${group.id} has no rules version ${group.currentVersion}`);
  return rules;
}

// The rules in force, as the app receives them.
function toRules(group: Pick<LoadedGroup, "id" | "currentVersion" | "rulesVersions">): GroupRules {
  const rules = currentRules(group);
  return {
    version: rules.version,
    amountFcfa: rules.amountFcfa,
    frequency: rules.frequency,
    dueDay: rules.dueDay,
    size: rules.size,
    payoutOrder: rules.payoutOrder,
    fixedOrder: rules.fixedOrder,
  };
}

function toDetail(group: LoadedGroup, userId: string): GroupDetail {
  return {
    id: group.id,
    name: group.name,
    state: group.state,
    mfiName: group.mfi.name,
    rules: toRules(group),
    seats: group.memberships.filter(holdsSeat).map((seat) => ({
      memberId: seat.userId,
      displayName: seat.user.displayName,
      role: seat.role,
      state: seat.state,
      acceptedCurrentRules: seat.state === "ACCEPTED" && seat.acceptedVersion === group.currentVersion,
      counterNote: seat.counterNote,
      payoutPosition: seat.payoutPosition,
    })),
    pendingInvites: group.invites.map((invite) => ({ id: invite.id, maskedPhone: maskPhone(invite.phone) })),
    myRole: group.organiserId === userId ? "ORGANISER" : "MEMBER",
  };
}

// Every place taken in the group: held seats, plus invitations waiting for an
// answer, which keep a place so the organiser cannot invite more people than
// the group's size.
function placesTaken(group: Pick<LoadedGroup, "memberships" | "invites">): Seat[] {
  const waiting: Seat[] = group.invites.map(() => ({ state: "INVITED", acceptedVersion: null }));
  return [...group.memberships, ...waiting];
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

// Saves the next version of the rules (D29). Every member's acceptance falls
// back to "not yet"; the organiser accepts the new version by proposing it.
// Earlier versions stay, as the record of what was agreed.
async function saveNextVersion(
  group: LoadedGroup,
  userId: string,
  rules: RulesInput & { fixedOrder: string[] },
  audit: "GROUP_RULES_REVISED" | "GROUP_ORDER_SET",
) {
  const groupId = group.id;
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
    await tx.auditEvent.create({ data: { userId, type: audit, details: { groupId, version } } });
  });
}

// Changes the amount, frequency, day, size or payout order. A fixed order
// already set is kept while the group stays FIXED; if it no longer fits,
// the start refuses it (D41).
export async function reviseRules(groupId: string, userId: string, rules: RulesInput): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "EDIT_RULES");
  enforce(checkRules(rules));
  const fixedOrder = rules.payoutOrder === "FIXED" ? currentRules(group).fixedOrder : [];
  await saveNextVersion(group, userId, { ...rules, fixedOrder }, "GROUP_RULES_REVISED");
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

// ---------- Invitations (S2.5) ----------

// Invites a phone number. It works the same whether or not the number has a
// Novi account, and the answer to the organiser is the same either way: she
// sees a masked number until the person answers (D38).
export async function inviteToGroup(groupId: string, userId: string, phone: string): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "INVITE");
  const rules = currentRules(group);
  enforce(checkCanInvite(placesTaken(group), rules.size));

  // Refused for a number already waiting for an answer, or already holding a seat.
  const invitee = await prisma.user.findUnique({ where: { phone }, select: { id: true, language: true } });
  const alreadySeated = invitee && group.memberships.some((seat) => seat.userId === invitee.id && holdsSeat(seat));
  if (alreadySeated || group.invites.some((invite) => invite.phone === phone)) {
    throw new AppError("ALREADY_INVITED", 409);
  }

  const organiser = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true, language: true } });
  await prisma.$transaction(async (tx) => {
    // An earlier invitation to this number that was withdrawn or answered is reused.
    await tx.invite.upsert({
      where: { groupId_phone: { groupId, phone } },
      create: { groupId, phone, invitedById: userId },
      update: { invitedById: userId, createdAt: new Date(), answeredAt: null, cancelledAt: null },
    });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_INVITE_SENT", details: { groupId } } });
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
export async function cancelInvite(groupId: string, userId: string, inviteId: string): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "REMOVE_SEAT");
  if (!group.invites.some((invite) => invite.id === inviteId)) throw new AppError("NOT_FOUND", 404);

  await prisma.$transaction(async (tx) => {
    await tx.invite.update({ where: { id: inviteId }, data: { cancelledAt: new Date() } });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_INVITE_CANCELLED", details: { groupId } } });
  });
  return getGroup(groupId, userId);
}

// Removes a member's seat before the group starts. The organiser's own seat
// cannot be removed: cancelling the group is how she stops it.
export async function removeSeat(groupId: string, userId: string, memberId: string): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "REMOVE_SEAT");
  if (memberId === group.organiserId) throw new AppError("CANNOT_REMOVE_ORGANISER", 400);
  const seat = group.memberships.find((s) => s.userId === memberId && holdsSeat(s));
  if (!seat) throw new AppError("NOT_FOUND", 404);

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: seat.id }, data: { state: "REMOVED", respondedAt: new Date() } });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_SEAT_REMOVED", details: { groupId, memberId } } });
  });
  return getGroup(groupId, userId);
}

// The invitations waiting for her answer, found by her verified phone number.
// A number invited before it had an account sees its invitations as soon as
// it signs up. Only groups still being set up or decided are shown.
export async function listMyInvitations(userId: string): Promise<Invitation[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
  const invites = await prisma.invite.findMany({
    where: { phone: user.phone, ...pending, group: { state: { in: ["DRAFT", "PROPOSED"] } } },
    orderBy: { createdAt: "desc" },
    include: { group: { include: { ...detailQuery, organiser: { select: { displayName: true } } } } },
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

// ---------- Answering (S2.6) ----------

// Loads a group for the person answering it: she holds a seat in it, or an
// invitation to her verified phone number is waiting. Anyone else is told the
// group does not exist, as in loadForMember.
async function loadForAnswer(groupId: string, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
  const group = await prisma.group.findUnique({ where: { id: groupId }, include: detailQuery });
  const seat = group?.memberships.find((s) => s.userId === userId && holdsSeat(s));
  const invite = group?.invites.find((i) => i.phone === user.phone);
  if (!group || (!seat && !invite)) throw new AppError("NOT_FOUND", 404);
  return { group, invite, isOrganiser: group.organiserId === userId };
}

type Answer = {
  state: SeatState;
  acceptedVersion: number | null;
  counterNote: string | null;
  audit: "GROUP_ACCEPTED" | "GROUP_COUNTERED" | "GROUP_DECLINED";
};

// Records her answer. Her seat is created from the invitation the first time
// she answers (D38), and the invitation is marked as used, so it no longer
// holds a place of its own.
async function recordAnswer(groupId: string, userId: string, inviteId: string | undefined, invitedById: string | undefined, answer: Answer) {
  const { audit, ...seat } = answer;
  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId, invitedById, ...seat, respondedAt: new Date() },
      update: { ...seat, respondedAt: new Date() },
    });
    if (inviteId) await tx.invite.update({ where: { id: inviteId }, data: { answeredAt: new Date() } });
    await tx.auditEvent.create({ data: { userId, type: audit, details: { groupId, version: answer.acceptedVersion } } });
  });
}

// She accepts the version of the rules she read. From now on the group counts
// towards her 3-group limit (D26), so she must have room for it.
export async function acceptRules(groupId: string, userId: string, versionSeen: number): Promise<GroupDetail> {
  const { group, invite, isOrganiser } = await loadForAnswer(groupId, userId);
  enforce(checkAction("RESPOND", group.state, isOrganiser));
  enforce(checkAnswersCurrentRules(versionSeen, group.currentVersion));
  enforce(checkCanJoin(await countActiveGroups(userId, groupId)));

  await recordAnswer(groupId, userId, invite?.id, invite?.invitedById, {
    state: "ACCEPTED",
    acceptedVersion: group.currentVersion,
    counterNote: null,
    audit: "GROUP_ACCEPTED",
  });
  return getGroup(groupId, userId);
}

// She asks for a change, with a note the whole group can read ("Saturday
// suits me better, the market is closed on Friday"). Her place is kept, but
// the group cannot start until the organiser changes the rules and she
// accepts the new version, or her seat is removed.
export async function counterRules(groupId: string, userId: string, versionSeen: number, note: string): Promise<GroupDetail> {
  const { group, invite, isOrganiser } = await loadForAnswer(groupId, userId);
  enforce(checkAction("RESPOND", group.state, isOrganiser));
  enforce(checkAnswersCurrentRules(versionSeen, group.currentVersion));

  await recordAnswer(groupId, userId, invite?.id, invite?.invitedById, {
    state: "COUNTERED",
    acceptedVersion: null,
    counterNote: note,
    audit: "GROUP_COUNTERED",
  });
  return getGroup(groupId, userId);
}

// She says no, or leaves a group she had accepted, before it starts. Her
// place is freed, and the group never sees her name: a declined seat is not
// shown, so saying no costs her nothing with the organiser.
export async function declineGroup(groupId: string, userId: string): Promise<void> {
  const { group, invite, isOrganiser } = await loadForAnswer(groupId, userId);
  enforce(checkAction("DECLINE", group.state, isOrganiser));

  await recordAnswer(groupId, userId, invite?.id, invite?.invitedById, {
    state: "DECLINED",
    acceptedVersion: null,
    counterNote: null,
    audit: "GROUP_DECLINED",
  });
}

// ---------- Payout order and start (S2.7) ----------

// The organiser sets who is paid first, second, and so on (D41): for example
// Abla first, because her shop rent is due. It needs every seat taken, so the
// order names real members, and it becomes a new version of the rules, so
// everyone accepts the exact order before the group can start (D29).
export async function setPayoutOrder(groupId: string, userId: string, memberIds: string[]): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "SET_ORDER");
  const rules = currentRules(group);
  const holders = group.memberships.filter(holdsSeat).map((seat) => seat.userId);
  if (holders.length !== rules.size) enforce({ ok: false, reason: "SEATS_NOT_FILLED" });
  enforce(checkFixedOrder(memberIds, holders));

  const { amountFcfa, frequency, dueDay, size } = rules;
  await saveNextVersion(
    group,
    userId,
    { amountFcfa, frequency, dueDay, size, payoutOrder: "FIXED", fixedOrder: memberIds },
    "GROUP_ORDER_SET",
  );
  return getGroup(groupId, userId);
}

// How many groups she has started (D27), not counting the group given.
async function countStarts(userId: string, exceptGroupId: string): Promise<number> {
  return prisma.group.count({
    where: { organiserId: userId, id: { not: exceptGroupId }, state: { in: ["STARTING", "ACTIVE", "COMPLETED"] } },
  });
}

// Has she kept paying until the end of a whole cycle in some group (D27)?
async function hasCompletedCycle(userId: string): Promise<boolean> {
  const seats = await prisma.membership.count({ where: { userId, state: "ACCEPTED", group: { state: "COMPLETED" } } });
  return seats > 0;
}

// Starts the group, in two steps.
// 1. Novi checks every rule, fixes the payout order and moves the group to
//    STARTING. From here nobody can leave or change anything.
// 2. Novi asks the MFI to open the group's account; once it answers, the
//    group is ACTIVE.
// If the MFI does not answer, the group waits in STARTING with its order
// kept, and the organiser can try again: the order is never drawn twice, so
// nobody can retry until the draw suits them.
export async function startGroup(groupId: string, userId: string): Promise<GroupDetail> {
  const { group } = await authorise(groupId, userId, "START");
  if (group.state === "PROPOSED") await fixOrder(group, userId);
  await openAccount(groupId, userId);
  return getGroup(groupId, userId);
}

async function fixOrder(group: LoadedGroup, userId: string) {
  const rules = currentRules(group);
  const seats = group.memberships.filter(holdsSeat);
  enforce(checkReadyToStart(seats, rules.size, group.currentVersion));
  enforce(checkCanStartAnother(await countStarts(userId, group.id), await hasCompletedCycle(userId)));

  const holders = seats.map((seat) => seat.userId);
  if (rules.payoutOrder === "FIXED") enforce(checkFixedOrder(rules.fixedOrder, holders));
  const order = rules.payoutOrder === "FIXED" ? rules.fixedOrder : drawOrder(holders);

  await prisma.$transaction(async (tx) => {
    // Only a group still PROPOSED moves on, so two taps on "Start" at the
    // same moment cannot draw two orders.
    const moved = await tx.group.updateMany({ where: { id: group.id, state: "PROPOSED" }, data: { state: "STARTING" } });
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
    await tx.auditEvent.create({ data: { userId, type: "GROUP_STARTING", details } });
  });
}

// Asks the MFI to open the account. The MFI is told group totals only: no
// names, no phone numbers (D33).
async function openAccount(groupId: string, userId: string) {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId }, include: { rulesVersions: true } });
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
    await prisma.auditEvent.create({ data: { userId, type: "GROUP_MFI_FAILED", details: { groupId } } });
    throw new AppError("MFI_UNAVAILABLE", 503);
  }

  await prisma.$transaction(async (tx) => {
    await tx.group.updateMany({
      where: { id: groupId, state: "STARTING" },
      data: { state: "ACTIVE", mfiAccountRef: accountRef, startedAt: new Date() },
    });
    await tx.auditEvent.create({ data: { userId, type: "GROUP_ACTIVE", details: { groupId } } });
  });
}