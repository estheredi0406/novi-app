import type { GroupHelp, TurnSwapView } from "@novi/shared";
import type { TurnSwap } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { holdsSeat } from "../lib/groupRules.js";
import { isoDay } from "../lib/schedule.js";
import { postEvent } from "./chatService.js";
import { notifyMembers } from "./notifyService.js";

// Help inside the group: what traders already do for each other in a
// tontine, with the group's agreement written down.
//
// D87, échange de tour: two members swap their turns to receive the pot, as
// traders do by hand when one needs money sooner. The member asked says yes,
// then the organiser confirms (unless she is one of the two). Only turns not
// yet paid out, and not due today, can move. No money is lent.
//
// D88 (an advance from the group's money) was removed by D115.

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const OPEN_SWAP = ["ASKED", "AGREED"] as const;

type Seat = { userId: string; payoutPosition: number | null; name: string };

// The group as the help rules need it: its seats, rounds and organiser.
async function loadGroup(groupId: string, userId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      rulesVersions: true,
      memberships: { include: { user: { select: { displayName: true } } } },
      rounds: {
        orderBy: { number: "asc" },
        include: { payout: { select: { status: true } } },
      },
    },
  });
  const mine = group?.memberships.find((m) => m.userId === userId);
  if (!group || !mine || !holdsSeat(mine) || mine.exitReason)
    throw new AppError("NOT_FOUND", 404);
  const seats: Seat[] = group.memberships
    .filter(
      (m) =>
        m.state === "ACCEPTED" && !m.exitReason && m.payoutPosition !== null,
    )
    .map((m) => ({
      userId: m.userId,
      payoutPosition: m.payoutPosition,
      name: m.user.displayName,
    }));
  const rules = group.rulesVersions.find(
    (r) => r.version === group.currentVersion,
  );
  return { group, seats, contributionFcfa: rules?.amountFcfa ?? 0 };
}
type Loaded = Awaited<ReturnType<typeof loadGroup>>;

// A turn can still move when its round has not been paid out and is not due
// today or earlier.
function turnCanMove(loaded: Loaded, round: number | null, now: Date): boolean {
  if (round === null) return false;
  const r = loaded.group.rounds.find((x) => x.number === round);
  return Boolean(r && !r.payout && isoDay(r.dueDate) > isoDay(now));
}

const nameOf = (loaded: Loaded, userId: string) =>
  loaded.seats.find((s) => s.userId === userId)?.name ?? "";
const roundOf = (loaded: Loaded, userId: string) =>
  loaded.seats.find((s) => s.userId === userId)?.payoutPosition ?? null;

function swapView(loaded: Loaded, s: TurnSwap, userId: string): TurnSwapView {
  const isOrganiser = loaded.group.organiserId === userId;
  return {
    id: s.id,
    requesterName: nameOf(loaded, s.requesterId),
    partnerName: nameOf(loaded, s.partnerId),
    requesterRound: s.requesterRound,
    partnerRound: s.partnerRound,
    status: s.status,
    mine: s.requesterId === userId,
    canAnswer: s.status === "ASKED" && s.partnerId === userId,
    canConfirm: s.status === "AGREED" && isOrganiser,
    canCancel:
      (s.status === "ASKED" || s.status === "AGREED") &&
      s.requesterId === userId,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function getGroupHelp(
  groupId: string,
  userId: string,
  now = new Date(),
): Promise<GroupHelp> {
  const loaded = await loadGroup(groupId, userId);
  const since = new Date(now.getTime() - RECENT_MS);
  const swaps = await prisma.turnSwap.findMany({
    where: {
      groupId,
      OR: [{ status: { in: [...OPEN_SWAP] } }, { createdAt: { gte: since } }],
    },
    orderBy: { createdAt: "desc" },
  });
  const myRound = roundOf(loaded, userId);
  const swapOpen = swaps.some(
    (s) =>
      (s.status === "ASKED" || s.status === "AGREED") &&
      (s.requesterId === userId || s.partnerId === userId),
  );
  const active = loaded.group.state === "ACTIVE";
  const swapPartners =
    active && turnCanMove(loaded, myRound, now)
      ? loaded.seats
          .filter(
            (s) =>
              s.userId !== userId && turnCanMove(loaded, s.payoutPosition, now),
          )
          .map((s) => ({
            memberId: s.userId,
            name: s.name,
            round: s.payoutPosition as number,
            dueDate: isoDay(
              loaded.group.rounds.find((r) => r.number === s.payoutPosition)
                ?.dueDate ?? now,
            ),
          }))
          .sort((a, b) => a.round - b.round)
      : [];
  return {
    swaps: swaps.map((s) => swapView(loaded, s, userId)),
    canSwap: !swapOpen && swapPartners.length > 0,
    swapPartners,
    myRound,
  };
}

// ---------- D87: swapping turns ----------

const groupUrl = (groupId: string) => `/groups/${groupId}?tab=groupe`;

export async function askSwap(
  groupId: string,
  userId: string,
  partnerId: string,
  now = new Date(),
) {
  const loaded = await loadGroup(groupId, userId);
  const myRound = roundOf(loaded, userId);
  const theirRound = roundOf(loaded, partnerId);
  const open = await prisma.turnSwap.count({
    where: {
      groupId,
      status: { in: [...OPEN_SWAP] },
      OR: [
        { requesterId: { in: [userId, partnerId] } },
        { partnerId: { in: [userId, partnerId] } },
      ],
    },
  });
  if (
    loaded.group.state !== "ACTIVE" ||
    partnerId === userId ||
    open > 0 ||
    !turnCanMove(loaded, myRound, now) ||
    !turnCanMove(loaded, theirRound, now)
  ) {
    throw new AppError("SWAP_NOT_POSSIBLE", 409);
  }
  await prisma.turnSwap.create({
    data: {
      groupId,
      requesterId: userId,
      partnerId,
      requesterRound: myRound as number,
      partnerRound: theirRound as number,
    },
  });
  await prisma.auditEvent.create({
    data: { userId, type: "SWAP_ASKED", details: { groupId, partnerId } },
  });
  const who = nameOf(loaded, userId);
  await notifyMembers(
    [partnerId],
    "money",
    groupUrl(groupId),
    {
      title: `${who} vous propose d'échanger vos tours`,
      body: `Tour ${myRound} contre votre tour ${theirRound}.`,
    },
    {
      title: `${who} asks to swap turns with you`,
      body: `Turn ${myRound} for your turn ${theirRound}.`,
    },
  );
  return getGroupHelp(groupId, userId, now);
}

// Swaps the two turns, if both can still move. Inside one transaction, so
// two confirmations at the same moment cannot both apply.
async function applySwap(
  loaded: Loaded,
  swap: TurnSwap,
  deciderId: string,
  now: Date,
): Promise<boolean> {
  const a = roundOf(loaded, swap.requesterId);
  const b = roundOf(loaded, swap.partnerId);
  if (
    a !== swap.requesterRound ||
    b !== swap.partnerRound ||
    !turnCanMove(loaded, a, now) ||
    !turnCanMove(loaded, b, now)
  ) {
    await prisma.turnSwap.update({
      where: { id: swap.id },
      data: { status: "CANCELLED" },
    });
    return false;
  }
  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.turnSwap.updateMany({
      where: { id: swap.id, status: { in: [...OPEN_SWAP] } },
      data: { status: "DONE", doneAt: now, decidedById: deciderId },
    });
    if (claimed.count === 0) return false;
    const groupId = swap.groupId;
    await tx.membership.update({
      where: { groupId_userId: { groupId, userId: swap.requesterId } },
      data: { payoutPosition: swap.partnerRound },
    });
    await tx.membership.update({
      where: { groupId_userId: { groupId, userId: swap.partnerId } },
      data: { payoutPosition: swap.requesterRound },
    });
    await tx.round.update({
      where: { groupId_number: { groupId, number: swap.partnerRound } },
      data: { beneficiaryId: swap.requesterId },
    });
    await tx.round.update({
      where: { groupId_number: { groupId, number: swap.requesterRound } },
      data: { beneficiaryId: swap.partnerId },
    });
    await tx.auditEvent.create({
      data: {
        userId: deciderId,
        type: "SWAP_DONE",
        details: { groupId, swapId: swap.id },
      },
    });
    return true;
  });
  if (!done) return false;
  await postEvent(
    swap.groupId,
    "TURN_SWAPPED",
    swap.requesterId,
    swap.partnerRound,
  );
  await postEvent(
    swap.groupId,
    "TURN_SWAPPED",
    swap.partnerId,
    swap.requesterRound,
  );
  await notifyMembers(
    [swap.requesterId, swap.partnerId],
    "money",
    groupUrl(swap.groupId),
    {
      title: "Échange de tour fait",
      body: `${nameOf(loaded, swap.requesterId)} et ${nameOf(loaded, swap.partnerId)} ont échangé leurs tours.`,
    },
    {
      title: "Turns swapped",
      body: `${nameOf(loaded, swap.requesterId)} and ${nameOf(loaded, swap.partnerId)} swapped turns.`,
    },
  );
  return true;
}

async function openSwap(groupId: string, swapId: string) {
  const swap = await prisma.turnSwap.findFirst({
    where: { id: swapId, groupId },
  });
  if (!swap) throw new AppError("NOT_FOUND", 404);
  return swap;
}

// The member asked says yes or no. If the organiser is one of the two, her
// yes is enough; otherwise the organiser confirms next.
export async function answerSwap(
  groupId: string,
  userId: string,
  swapId: string,
  yes: boolean,
  now = new Date(),
) {
  const loaded = await loadGroup(groupId, userId);
  const swap = await openSwap(groupId, swapId);
  if (swap.partnerId !== userId || swap.status !== "ASKED")
    throw new AppError("NOT_ALLOWED_NOW", 409);
  if (!yes) {
    await prisma.turnSwap.update({
      where: { id: swap.id },
      data: { status: "DECLINED", answeredAt: now },
    });
    await notifyMembers(
      [swap.requesterId],
      "money",
      groupUrl(groupId),
      {
        title: "Échange de tour refusé",
        body: `${nameOf(loaded, userId)} garde son tour.`,
      },
      {
        title: "Swap declined",
        body: `${nameOf(loaded, userId)} keeps her turn.`,
      },
    );
    return getGroupHelp(groupId, userId, now);
  }
  const organiserId = loaded.group.organiserId;
  if (swap.requesterId === organiserId || swap.partnerId === organiserId) {
    await prisma.turnSwap.update({
      where: { id: swap.id },
      data: { answeredAt: now },
    });
    if (!(await applySwap(loaded, swap, userId, now)))
      throw new AppError("SWAP_NOT_POSSIBLE", 409);
  } else {
    await prisma.turnSwap.update({
      where: { id: swap.id },
      data: { status: "AGREED", answeredAt: now },
    });
    await notifyMembers(
      [organiserId],
      "money",
      groupUrl(groupId),
      {
        title: "Un échange de tour attend votre accord",
        body: `${nameOf(loaded, swap.requesterId)} et ${nameOf(loaded, swap.partnerId)} veulent échanger leurs tours.`,
      },
      {
        title: "A turn swap needs your approval",
        body: `${nameOf(loaded, swap.requesterId)} and ${nameOf(loaded, swap.partnerId)} want to swap turns.`,
      },
    );
  }
  return getGroupHelp(groupId, userId, now);
}

export async function decideSwap(
  groupId: string,
  userId: string,
  swapId: string,
  yes: boolean,
  now = new Date(),
) {
  const loaded = await loadGroup(groupId, userId);
  if (loaded.group.organiserId !== userId)
    throw new AppError("ORGANISER_ONLY", 403);
  const swap = await openSwap(groupId, swapId);
  if (swap.status !== "AGREED") throw new AppError("NOT_ALLOWED_NOW", 409);
  if (yes) {
    if (!(await applySwap(loaded, swap, userId, now)))
      throw new AppError("SWAP_NOT_POSSIBLE", 409);
  } else {
    await prisma.turnSwap.update({
      where: { id: swap.id },
      data: { status: "DECLINED", decidedById: userId },
    });
    await notifyMembers(
      [swap.requesterId, swap.partnerId],
      "money",
      groupUrl(groupId),
      {
        title: "Échange de tour refusé",
        body: "L'organisatrice n'a pas confirmé l'échange.",
      },
      {
        title: "Swap declined",
        body: "The organiser did not confirm the swap.",
      },
    );
  }
  return getGroupHelp(groupId, userId, now);
}

export async function cancelSwap(
  groupId: string,
  userId: string,
  swapId: string,
  now = new Date(),
) {
  await loadGroup(groupId, userId);
  const swap = await openSwap(groupId, swapId);
  const moved = await prisma.turnSwap.updateMany({
    where: { id: swap.id, requesterId: userId, status: { in: [...OPEN_SWAP] } },
    data: { status: "CANCELLED" },
  });
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  return getGroupHelp(groupId, userId, now);
}
