import type { ChatMessage, ChatPage } from "@novi/shared";
import type { GroupMessage } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { holdsSeat } from "../lib/groupRules.js";

// The group's chat (D70). A tontine is a group of people who know each
// other; the chat is where they remind, encourage and agree, as they would
// at the market. Only the group's members read it, never the MFI (D33).
// Novi adds a line itself when money moves (a payment, a pot paid), so the
// chat is also the group's running story. The app asks for new lines every
// few seconds while the chat is open: no extra service to run on Render, and
// it works the same on a weak connection.

const PAGE = 50;
export const MAX_LENGTH = 500;
// More than this many messages in a minute is a runaway phone or spam.
const PER_MINUTE = 10;

async function seatOf(groupId: string, userId: string) {
  const seat = await prisma.membership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    include: { group: { select: { state: true, organiserId: true } }, user: { select: { closedAt: true } } },
  });
  if (!seat || !holdsSeat(seat)) throw new AppError("NOT_FOUND", 404);
  return seat;
}

// She may write while she holds a seat in a group that has not been cancelled,
// and has not left it (D69). A seat exists once she has answered the
// invitation: accepted, or asked for a change (COUNTERED), so a member
// discussing the rules can do it here. Before she answers she is only an
// invited number, and the group does not know she uses Novi (D38).
function canWrite(seat: Awaited<ReturnType<typeof seatOf>>): boolean {
  return seat.group.state !== "CANCELLED" && seat.exitReason === null && seat.user.closedAt === null;
}

type Loaded = GroupMessage & { author: { displayName: string } | null };

function toMessage(m: Loaded, userId: string, isOrganiser: boolean): ChatMessage {
  const hidden = m.hiddenAt !== null;
  return {
    id: m.id,
    kind: m.kind,
    authorId: m.userId,
    authorName: m.author?.displayName ?? null,
    mine: m.kind === "TEXT" && m.userId === userId,
    body: hidden ? null : m.body,
    event: m.event === "PAID" || m.event === "POT_PAID" ? m.event : null,
    round: m.round,
    hidden,
    canHide: m.kind === "TEXT" && !hidden && (m.userId === userId || isOrganiser),
    createdAt: m.createdAt.toISOString(),
  };
}

// The latest page, or the lines after one she already has (after), or the
// page before one (before). Opening the chat marks it as read.
export async function listMessages(
  groupId: string,
  userId: string,
  cursor: { after?: string; before?: string },
): Promise<ChatPage> {
  const seat = await seatOf(groupId, userId);
  const isOrganiser = seat.group.organiserId === userId;
  const anchorId = cursor.after ?? cursor.before;
  const anchor = anchorId
    ? await prisma.groupMessage.findFirst({ where: { id: anchorId, groupId }, select: { createdAt: true } })
    : null;
  if (anchorId && !anchor) throw new AppError("NOT_FOUND", 404);

  const include = { author: { select: { displayName: true } } };
  let rows: Loaded[];
  let hasEarlier = false;
  if (cursor.after && anchor) {
    rows = await prisma.groupMessage.findMany({
      where: { groupId, createdAt: { gt: anchor.createdAt } },
      orderBy: { createdAt: "asc" },
      take: 200,
      include,
    });
  } else {
    const newestFirst = await prisma.groupMessage.findMany({
      where: { groupId, ...(anchor ? { createdAt: { lt: anchor.createdAt } } : {}) },
      orderBy: { createdAt: "desc" },
      take: PAGE + 1,
      include,
    });
    hasEarlier = newestFirst.length > PAGE;
    rows = newestFirst.slice(0, PAGE).reverse();
  }

  if (!cursor.before) {
    await prisma.membership.update({ where: { id: seat.id }, data: { chatReadAt: new Date() } });
  }
  return { messages: rows.map((m) => toMessage(m, userId, isOrganiser)), hasEarlier, canWrite: canWrite(seat) };
}

export async function postMessage(groupId: string, userId: string, text: string): Promise<ChatMessage> {
  const seat = await seatOf(groupId, userId);
  if (!canWrite(seat)) throw new AppError("NOT_ALLOWED_NOW", 409);
  const body = text.trim();
  if (body.length === 0 || body.length > MAX_LENGTH) throw new AppError("VALIDATION_FAILED", 400);

  const lastMinute = await prisma.groupMessage.count({
    where: { userId, kind: "TEXT", createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (lastMinute >= PER_MINUTE) throw new AppError("RATE_LIMITED", 429);

  const message = await prisma.groupMessage.create({
    data: { groupId, userId, kind: "TEXT", body },
    include: { author: { select: { displayName: true } } },
  });
  await prisma.membership.update({ where: { id: seat.id }, data: { chatReadAt: message.createdAt } });
  return toMessage(message, userId, seat.group.organiserId === userId);
}

// Hiding keeps the line, without its words: the group sees that a message
// was removed, and by whom it was written, so nothing disappears silently.
export async function hideMessage(groupId: string, userId: string, messageId: string): Promise<ChatMessage> {
  const seat = await seatOf(groupId, userId);
  const isOrganiser = seat.group.organiserId === userId;
  const message = await prisma.groupMessage.findFirst({ where: { id: messageId, groupId } });
  if (!message) throw new AppError("NOT_FOUND", 404);
  if (message.kind !== "TEXT" || (message.userId !== userId && !isOrganiser)) {
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  const hidden = await prisma.groupMessage.update({
    where: { id: messageId },
    data: { hiddenAt: message.hiddenAt ?? new Date(), hiddenById: message.hiddenById ?? userId },
    include: { author: { select: { displayName: true } } },
  });
  await prisma.auditEvent.create({
    data: { userId, type: "CHAT_MESSAGE_HIDDEN", details: { groupId, messageId, ownMessage: message.userId === userId } },
  });
  return toMessage(hidden, userId, isOrganiser);
}

// Novi's own line when money moves. Never stops what called it: the money
// is what matters, the chat line is a courtesy.
export async function postEvent(
  groupId: string,
  event: "PAID" | "POT_PAID",
  userId: string,
  round: number,
): Promise<void> {
  try {
    await prisma.groupMessage.create({ data: { groupId, userId, kind: "EVENT", event, round } });
  } catch (err) {
    console.error(`Chat event ${event} for group ${groupId} not written:`, err);
  }
}

// How many lines arrived since she last opened the chat, not counting her own.
export async function unreadCount(groupId: string, userId: string, readAt: Date | null): Promise<number> {
  return prisma.groupMessage.count({
    where: {
      groupId,
      ...(readAt ? { createdAt: { gt: readAt } } : {}),
      OR: [{ userId: null }, { userId: { not: userId } }],
    },
  });
}
