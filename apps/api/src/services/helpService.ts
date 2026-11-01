import type { AdvanceView, GroupHelp, TurnSwapView } from "@novi/shared";
import type { Advance, TurnSwap } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { holdsSeat } from "../lib/groupRules.js";
import { isoDay } from "../lib/schedule.js";
import { postEvent } from "./chatService.js";
import { alertStaff } from "./alertService.js";
import { owedCovers } from "./memberService.js";
import { notifyMembers } from "./notifyService.js";
import { fundBalance } from "./reserveService.js";

// Help inside the group: what traders already do for each other in a
// tontine, with the group's agreement written down.
//
// D87, échange de tour: two members swap their turns to receive the pot, as
// traders do by hand when one needs money sooner. The member asked says yes,
// then the organiser confirms (unless she is one of the two). Only turns not
// yet paid out, and not due today, can move. No money is lent.
//
// D88, avance de la caisse: in an emergency, a member who has not received
// her pot yet may ask the solidarity fund for up to one contribution. The
// organiser and one other member approve; the MFI officer sends it; her own
// pot repays it on her turn, with no interest. Her future pot is the
// guarantee, so a member who already received hers cannot ask.

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const OPEN_SWAP = ["ASKED", "AGREED"] as const;
const OPEN_ADVANCE = ["ASKED", "APPROVED", "SENT", "PAID"] as const;
const ADVANCE_MIN_FCFA = 500;

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

// Two approvals: the organiser and one other member. When the organiser is
// the one asking, two other members.
function approvalSlot(
  loaded: Loaded,
  a: Advance,
  userId: string,
): "organiserApproval" | "memberApproval" | null {
  if (a.status !== "ASKED" || a.userId === userId) return null;
  if (a.organiserApproval === userId || a.memberApproval === userId)
    return null;
  const organiserId = loaded.group.organiserId;
  const borrowerIsOrganiser = a.userId === organiserId;
  if (!borrowerIsOrganiser && userId === organiserId)
    return a.organiserApproval ? null : "organiserApproval";
  if (!a.memberApproval) return "memberApproval";
  if (borrowerIsOrganiser && !a.organiserApproval) return "organiserApproval";
  return null;
}

function advanceView(loaded: Loaded, a: Advance, userId: string): AdvanceView {
  return {
    id: a.id,
    borrowerName: nameOf(loaded, a.userId),
    mine: a.userId === userId,
    amountFcfa: a.amountFcfa,
    reason: a.reason,
    status: a.status,
    approvals: (a.organiserApproval ? 1 : 0) + (a.memberApproval ? 1 : 0),
    canApprove: approvalSlot(loaded, a, userId) !== null,
    canCancel: a.status === "ASKED" && a.userId === userId,
    createdAt: a.createdAt.toISOString(),
  };
}

// Paid every round already due in this group, and owes the fund nothing.
async function upToDate(
  loaded: Loaded,
  userId: string,
  now: Date,
): Promise<boolean> {
  const today = isoDay(now);
  const pastRounds = loaded.group.rounds
    .filter((r) => isoDay(r.dueDate) < today)
    .map((r) => r.id);
  if (pastRounds.length > 0) {
    const paid = await prisma.contribution.count({
      where: { userId, status: "PAID", roundId: { in: pastRounds } },
    });
    if (paid < pastRounds.length) return false;
  }
  return (await owedCovers(userId)) === 0;
}

async function canAskAdvance(
  loaded: Loaded,
  userId: string,
  now: Date,
): Promise<boolean> {
  if (loaded.group.state !== "ACTIVE") return false;
  // Her pot is the guarantee: it must still be to come.
  if (!turnCanMove(loaded, roundOf(loaded, userId), now)) return false;
  const open = await prisma.advance.count({
    where: { userId, status: { in: [...OPEN_ADVANCE] } },
  });
  if (open > 0) return false;
  return upToDate(loaded, userId, now);
}

export async function getGroupHelp(
  groupId: string,
  userId: string,
  now = new Date(),
): Promise<GroupHelp> {
  const loaded = await loadGroup(groupId, userId);
  const since = new Date(now.getTime() - RECENT_MS);
  const [swaps, advances] = await Promise.all([
    prisma.turnSwap.findMany({
      where: {
        groupId,
        OR: [{ status: { in: [...OPEN_SWAP] } }, { createdAt: { gte: since } }],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.advance.findMany({
      where: {
        groupId,
        OR: [
          { status: { in: [...OPEN_ADVANCE] } },
          { createdAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const myRound = roundOf(loaded, userId);
  const swapOpen = swaps.some(
    (s) =>
      (s.status === "ASKED" || s.status === "AGREED") &&
      (s.requesterId === userId || s.partnerId === userId),
  );
  const active = loaded.group.state === "ACTIVE";
  // The fund is shared by every group at the MFI (D68); in a small pilot it
  // may hold less than one contribution, so the advance is capped by it too.
  const fund = await fundBalance(loaded.group.mfiId);
  const advanceMaxFcfa = Math.max(
    0,
    Math.min(loaded.contributionFcfa, Math.floor(fund / 100) * 100),
  );
  const eligible = await canAskAdvance(loaded, userId, now);
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
    advances: advances.map((a) => advanceView(loaded, a, userId)),
    canSwap: !swapOpen && swapPartners.length > 0,
    canAskAdvance: eligible && advanceMaxFcfa >= ADVANCE_MIN_FCFA,
    advanceMaxFcfa,
    fundTooLow: eligible && advanceMaxFcfa < ADVANCE_MIN_FCFA,
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

// ---------- D88: an advance from the solidarity fund ----------

export async function askAdvance(
  groupId: string,
  userId: string,
  input: { amountFcfa: number; reason?: string },
  now = new Date(),
) {
  const loaded = await loadGroup(groupId, userId);
  if (
    input.amountFcfa < ADVANCE_MIN_FCFA ||
    input.amountFcfa > loaded.contributionFcfa
  ) {
    throw new AppError("ADVANCE_TOO_LARGE", 400);
  }
  if (!(await canAskAdvance(loaded, userId, now)))
    throw new AppError("ADVANCE_NOT_ALLOWED", 409);
  if ((await fundBalance(loaded.group.mfiId)) < input.amountFcfa)
    throw new AppError("FUND_TOO_LOW", 409);

  await prisma.advance.create({
    data: {
      groupId,
      userId,
      amountFcfa: input.amountFcfa,
      reason: input.reason?.trim() || null,
    },
  });
  await prisma.auditEvent.create({
    data: {
      userId,
      type: "ADVANCE_ASKED",
      details: { groupId, amountFcfa: input.amountFcfa },
    },
  });
  const others = loaded.seats
    .map((s) => s.userId)
    .filter((id) => id !== userId);
  const who = nameOf(loaded, userId);
  const amount = `${String(input.amountFcfa).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} F`;
  await notifyMembers(
    others,
    "money",
    groupUrl(groupId),
    {
      title: `${who} demande une avance de ${amount}`,
      body: "L'organisatrice et un membre peuvent l'accepter.",
    },
    {
      title: `${who} asks for an advance of ${amount}`,
      body: "The organiser and one member can approve it.",
    },
  );
  return getGroupHelp(groupId, userId, now);
}

export async function decideAdvance(
  groupId: string,
  userId: string,
  advanceId: string,
  yes: boolean,
  now = new Date(),
) {
  const loaded = await loadGroup(groupId, userId);
  const advance = await prisma.advance.findFirst({
    where: { id: advanceId, groupId },
  });
  if (!advance) throw new AppError("NOT_FOUND", 404);
  const slot = approvalSlot(loaded, advance, userId);
  if (!slot) throw new AppError("NOT_ALLOWED_NOW", 409);

  if (!yes) {
    await prisma.advance.updateMany({
      where: { id: advance.id, status: "ASKED" },
      data: { status: "DECLINED", declinedById: userId },
    });
    await notifyMembers(
      [advance.userId],
      "money",
      groupUrl(groupId),
      {
        title: "Avance refusée",
        body: `${nameOf(loaded, userId)} n'a pas accepté votre demande.`,
      },
      {
        title: "Advance declined",
        body: `${nameOf(loaded, userId)} did not approve your request.`,
      },
    );
    return getGroupHelp(groupId, userId, now);
  }

  const updated = await prisma.advance.update({
    where: { id: advance.id },
    data: { [slot]: userId },
  });
  if (updated.organiserApproval && updated.memberApproval) {
    await prisma.advance.updateMany({
      where: { id: advance.id, status: "ASKED" },
      data: { status: "APPROVED" },
    });
    await prisma.auditEvent.create({
      data: {
        userId,
        type: "ADVANCE_APPROVED",
        details: { groupId, advanceId },
      },
    });
    // D90: the officers send it from the fund.
    await alertStaff({
      mfiId: loaded.group.mfiId,
      kind: "ADVANCE_TO_SEND",
      refId: advance.id,
      groupId,
      subject: `Avance à verser : ${loaded.group.name}`,
      lines: [
        `« ${loaded.group.name} » a approuvé une avance de ${advance.amountFcfa} FCFA depuis le fonds solidaire.`,
        "Elle sera reprise sur la cagnotte de la bénéficiaire.",
      ],
    });
    await notifyMembers(
      [advance.userId],
      "money",
      groupUrl(groupId),
      {
        title: "Votre avance est acceptée",
        body: "FUCEC l'envoie sur votre Mobile Money. Elle sera reprise sur votre cagnotte.",
      },
      {
        title: "Your advance is approved",
        body: "FUCEC sends it to your mobile money. It comes back out of your pot.",
      },
    );
  }
  return getGroupHelp(groupId, userId, now);
}

export async function cancelAdvance(
  groupId: string,
  userId: string,
  advanceId: string,
  now = new Date(),
) {
  await loadGroup(groupId, userId);
  const moved = await prisma.advance.updateMany({
    where: { id: advanceId, groupId, userId, status: "ASKED" },
    data: { status: "CANCELLED" },
  });
  if (moved.count === 0) throw new AppError("NOT_ALLOWED_NOW", 409);
  return getGroupHelp(groupId, userId, now);
}
