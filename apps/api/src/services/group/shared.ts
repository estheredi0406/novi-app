// Pieces every part of the group service uses: loading a group, the rules in
// force, the seats, and who may do what.

import type { GroupRules, PartnerMfi } from "@novi/shared";
import { Prisma } from "../../generated/prisma/client.js";
import type { Frequency, PayoutOrder } from "../../generated/prisma/enums.js";
import { prisma } from "../../lib/db.js";
import { enforce } from "../../lib/enforce.js";
import { AppError } from "../../lib/errors.js";
import { checkAction, type GroupAction, holdsSeat, type Seat } from "../../lib/groupRules.js";
import { mfi } from "../../providers/index.js";
import { notifyOrSms } from "../notifyService.js";
import { owedCovers } from "../memberService.js";

// D69: a member who still owes the solidarity fund a covered share settles it
// before she commits to a new group, so a debt cannot be left behind.
export async function refuseIfOwing(userId: string): Promise<void> {
  if ((await owedCovers(userId)) > 0)
    throw new AppError("DEBT_OUTSTANDING", 409);
}

// The partner MFIs have made-up names (D120): Novi has no agreement with a real
// one. The default MFI is created when first needed; the others with their
// first officer, so a group never picks an MFI with nobody to validate it.
export const PILOT_MFIS = [
  { code: "MAWULI", name: "Caisse Mawuli" },
  { code: "DZIDZO", name: "Caisse Dzidzo" },
] as const;

const PARTNER_MFI = PILOT_MFIS[0];

export type RulesInput = {
  amountFcfa: number;
  frequency: Frequency;
  dueDay: number;
  size: number;
  payoutOrder: PayoutOrder;
  // D95: the MFI chosen to keep the money. Left out by older app versions:
  // the group then keeps its MFI, or a new group gets the default partner.
  mfiId?: string;
};

// Every partner MFI a group can choose (D95), the default partner first.
export async function listPartnerMfis(): Promise<PartnerMfi[]> {
  await prisma.mfi.upsert({ where: { code: PARTNER_MFI.code }, create: PARTNER_MFI, update: {} });
  const mfis = await prisma.mfi.findMany({ orderBy: { createdAt: "asc" } });
  return mfis
    .map(({ id, code, name }) => ({ id, code, name }))
    .sort((a, b) => Number(b.code === PARTNER_MFI.code) - Number(a.code === PARTNER_MFI.code));
}

// The MFI a group asked for, or the default partner when none was given.
export async function chooseMfi(db: Prisma.TransactionClient | typeof prisma, mfiId: string | undefined) {
  if (mfiId === undefined) {
    return db.mfi.upsert({ where: { code: PARTNER_MFI.code }, create: PARTNER_MFI, update: {} });
  }
  const mfi = await db.mfi.findUnique({ where: { id: mfiId } });
  if (!mfi) throw new AppError("MFI_UNKNOWN", 400);
  return mfi;
}

// An invitation still waiting for an answer: not answered, not withdrawn.
export const pending = { answeredAt: null, cancelledAt: null };

// Everything needed to show one group: its MFI, every version of its rules
// (the current one is picked below), every seat with the holder's name, and
// the invitations not answered yet.
export const detailQuery = {
  mfi: true,
  nextCycle: { select: { id: true } },
  rulesVersions: { orderBy: { version: "desc" as const } },
  memberships: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { displayName: true, phone: true } } },
  },
  invites: { where: pending, orderBy: { createdAt: "asc" as const } },
};

// Loads a group for this member, or answers NOT_FOUND. A person with no seat
// in the group gets the same answer as for a group that does not exist, so
// nobody can find out which groups exist by guessing their IDs.
export async function loadForMember(groupId: string, userId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: detailQuery,
  });
  const mySeat = group?.memberships.find((seat) => seat.userId === userId);
  if (!group || !mySeat || !holdsSeat(mySeat))
    throw new AppError("NOT_FOUND", 404);
  return { group, mySeat, isOrganiser: group.organiserId === userId };
}

export type LoadedGroup = Awaited<ReturnType<typeof loadForMember>>["group"];

// The rules version in force now.
export function currentRules(
  group: Pick<LoadedGroup, "id" | "currentVersion" | "rulesVersions">,
) {
  const rules = group.rulesVersions.find(
    (v) => v.version === group.currentVersion,
  );
  if (!rules)
    throw new Error(
      `group ${group.id} has no rules version ${group.currentVersion}`,
    );
  return rules;
}

// The rules in force, as the app receives them.
export function toRules(
  group: Pick<LoadedGroup, "id" | "currentVersion" | "rulesVersions">,
): GroupRules {
  const rules = currentRules(group);
  return {
    version: rules.version,
    amountFcfa: rules.amountFcfa,
    frequency: rules.frequency,
    dueDay: rules.dueDay,
    size: rules.size,
    payoutOrder: rules.payoutOrder,
    fixedOrder: rules.fixedOrder,
    mfiId: rules.mfiId,
  };
}

// Every place taken in the group: held seats, plus invitations waiting for an
// answer, which keep a place so the organiser cannot invite more people than
// the group's size.
export function placesTaken(
  group: Pick<LoadedGroup, "memberships" | "invites">,
): Seat[] {
  const waiting: Seat[] = group.invites.map(() => ({
    state: "INVITED",
    acceptedVersion: null,
  }));
  return [...group.memberships, ...waiting];
}

// Loads the group and checks that this member may do this action now.
export async function authorise(groupId: string, userId: string, action: GroupAction) {
  const loaded = await loadForMember(groupId, userId);
  enforce(checkAction(action, loaded.group.state, loaded.isOrganiser));
  return loaded;
}

// Saves the next version of the rules (D29). Every member's acceptance falls
// back to "not yet"; the organiser accepts the new version by proposing it.
// Earlier versions stay, as the record of what was agreed.
export async function saveNextVersion(
  group: LoadedGroup,
  userId: string,
  rules: Omit<RulesInput, "mfiId"> & { fixedOrder: string[]; mfiId: string },
  audit: "GROUP_RULES_REVISED" | "GROUP_ORDER_SET",
) {
  const groupId = group.id;
  const version = group.currentVersion + 1;
  const mfiChanged = rules.mfiId !== group.mfiId;
  // Who had answered: they now have to read and answer the new version.
  const answered = group.memberships
    .filter((m) => m.role === "MEMBER" && (m.state === "ACCEPTED" || m.state === "COUNTERED"))
    .map((m) => m.userId);

  await prisma.$transaction(async (tx) => {
    await tx.rulesVersion.create({
      data: { groupId, version, proposedById: userId, ...rules },
    });
    await tx.group.update({
      where: { id: groupId },
      data: { currentVersion: version, mfiId: rules.mfiId },
    });
    // D95, D98: an agreement to share her record was given to one MFI; it
    // does not carry over to another.
    if (mfiChanged) {
      await tx.membership.updateMany({
        where: { groupId },
        data: { shareConsentAt: null },
      });
    }
    await tx.membership.updateMany({
      where: {
        groupId,
        role: "MEMBER",
        state: { in: ["ACCEPTED", "COUNTERED"] },
      },
      data: { state: "INVITED", counterNote: null, respondedAt: null },
    });
    await tx.membership.updateMany({
      where: { groupId, role: "ORGANISER" },
      data: {
        state: "ACCEPTED",
        acceptedVersion: version,
        respondedAt: new Date(),
      },
    });
    await tx.auditEvent.create({
      data: { userId, type: audit, details: { groupId, version } },
    });
  });
  // D162: they hear it, instead of finding their "A accepté" gone.
  const order = audit === "GROUP_ORDER_SET";
  await notifyOrSms(
    answered,
    `/groups/${groupId}`,
    {
      title: `${group.name} : nouvelle version des règles`,
      body: order
        ? "L'ordre des tours est fixé. Relisez-le et acceptez pour que le groupe démarre."
        : "Les règles ont changé. Relisez-les et répondez.",
    },
    {
      title: `${group.name}: new version of the rules`,
      body: order
        ? "The order of turns is set. Read it and accept so the group can start."
        : "The rules have changed. Read them and answer.",
    },
    4, // D165: on USSD she answers in menu 4
  );
}
