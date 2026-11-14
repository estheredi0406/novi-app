// A member answers the rules: accept, ask for a change, or say no.

import type { GroupDetail } from "@novi/shared";
import type { SeatState } from "../../generated/prisma/enums.js";
import { prisma } from "../../lib/db.js";
import { enforce } from "../../lib/enforce.js";
import { AppError } from "../../lib/errors.js";
import {
  checkAction,
  checkAnswersCurrentRules,
  checkCanJoin,
  checkFixedOrder,
  holdsSeat,
} from "../../lib/groupRules.js";
import { notifyMembers } from "../notifyService.js";
import { detailQuery, refuseIfOwing } from "./shared.js";
import { countActiveGroups, getGroup } from "./reading.js";

// Loads a group for the person answering it: she holds a seat in it, or an
// invitation to her verified phone number is waiting. Anyone else is told the
// group does not exist, as in loadForMember.
async function loadForAnswer(groupId: string, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { phone: true },
  });
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: detailQuery,
  });
  const seat = group?.memberships.find(
    (s) => s.userId === userId && holdsSeat(s),
  );
  const invite = group?.invites.find((i) => i.phone === user.phone);
  if (!group || (!seat && !invite)) throw new AppError("NOT_FOUND", 404);
  return { group, invite, isOrganiser: group.organiserId === userId };
}

type Answer = {
  state: SeatState;
  acceptedVersion: number | null;
  counterNote: string | null;
  shareConsentAt?: Date;
  audit: "GROUP_ACCEPTED" | "GROUP_COUNTERED" | "GROUP_DECLINED";
};

// Records her answer. Her seat is created from the invitation the first time
// she answers (D38), and the invitation is marked as used, so it no longer
// holds a place of its own.
async function recordAnswer(
  groupId: string,
  userId: string,
  inviteId: string | undefined,
  invitedById: string | undefined,
  answer: Answer,
) {
  const { audit, ...seat } = answer;
  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: {
        groupId,
        userId,
        invitedById,
        ...seat,
        respondedAt: new Date(),
      },
      update: { ...seat, respondedAt: new Date() },
    });
    if (inviteId)
      await tx.invite.update({
        where: { id: inviteId },
        data: { answeredAt: new Date() },
      });
    await tx.auditEvent.create({
      data: {
        userId,
        type: audit,
        details: { groupId, version: answer.acceptedVersion },
      },
    });
  });
}

// She accepts the rules she read; the group now counts in her 3-group limit
// (D26). D84: shareConsent lets the MFI see her record when it checks the group.
export async function acceptRules(
  groupId: string,
  userId: string,
  versionSeen: number,
  shareConsent = false,
): Promise<GroupDetail> {
  const { group, invite, isOrganiser } = await loadForAnswer(groupId, userId);
  enforce(checkAction("RESPOND", group.state, isOrganiser));
  enforce(checkAnswersCurrentRules(versionSeen, group.currentVersion));
  enforce(checkCanJoin(await countActiveGroups(userId, groupId)));
  await refuseIfOwing(userId);

  await recordAnswer(groupId, userId, invite?.id, invite?.invitedById, {
    state: "ACCEPTED",
    acceptedVersion: group.currentVersion,
    counterNote: null,
    ...(shareConsent ? { shareConsentAt: new Date() } : {}),
    audit: "GROUP_ACCEPTED",
  });
  const detail = await getGroup(groupId, userId);
  if (!isOrganiser) await tellOrganiserIfReady(detail, group.organiserId);
  return detail;
}

// D162: the last answer makes the group ready: the organiser hears that it
// is her turn to act (set the order of turns if she chose it, then start),
// instead of finding out by opening the group.
async function tellOrganiserIfReady(detail: GroupDetail, organiserId: string) {
  const ready =
    detail.state === "PROPOSED" &&
    detail.pendingInvites.length === 0 &&
    detail.seats.length === detail.rules.size &&
    detail.seats.every((s) => s.acceptedCurrentRules);
  if (!ready) return;
  const needsOrder =
    detail.rules.payoutOrder === "FIXED" &&
    !checkFixedOrder(detail.rules.fixedOrder, detail.seats.map((s) => s.memberId)).ok;
  await notifyMembers(
    [organiserId],
    "money",
    `/groups/${detail.id}`,
    {
      title: `${detail.name} : tout le monde a accepté`,
      body: needsOrder ? "Fixez l'ordre des tours, puis démarrez le groupe." : "Vous pouvez démarrer le groupe.",
    },
    {
      title: `${detail.name}: everyone has accepted`,
      body: needsOrder ? "Set the order of turns, then start the group." : "You can start the group.",
    },
  );
}

// She asks for a change, with a note the group can read. Her place is kept, but
// the group cannot start until the rules change and she accepts.
export async function counterRules(
  groupId: string,
  userId: string,
  versionSeen: number,
  note: string,
): Promise<GroupDetail> {
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
export async function declineGroup(
  groupId: string,
  userId: string,
): Promise<void> {
  const { group, invite, isOrganiser } = await loadForAnswer(groupId, userId);
  enforce(checkAction("DECLINE", group.state, isOrganiser));

  await recordAnswer(groupId, userId, invite?.id, invite?.invitedById, {
    state: "DECLINED",
    acceptedVersion: null,
    counterNote: null,
    audit: "GROUP_DECLINED",
  });
}
