import type { ChatMessage, ChatPage, VoiceAudio } from "@novi/shared";
import type { GroupMessage } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { holdsSeat } from "../lib/groupRules.js";
import { stateOf } from "./meetingService.js";
import { notifyChat } from "./notifyService.js";

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
// A voice note: one minute at most, recorded small (mono AAC, about 32 kbit/s,
// so a full minute is about 240 KB). The limit leaves room for a phone that
// records a little richer, and refuses anything that is not a short note.
export const VOICE_MAX_MS = 60_000;
export const VOICE_MAX_BYTES = 600_000;
const VOICE_MIMES = ["audio/mp4", "audio/m4a", "audio/aac", "audio/x-m4a"];

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

type Loaded = GroupMessage & {
  author: { displayName: string } | null;
  meeting: {
    id: string;
    title: string;
    startsAt: Date;
    durationMin: number;
    cancelledAt: Date | null;
    instant: boolean;
  } | null;
  voice: { messageId: string } | null;
};
const include = {
  author: { select: { displayName: true } },
  meeting: { select: { id: true, title: true, startsAt: true, durationMin: true, cancelledAt: true, instant: true } },
  voice: { select: { messageId: true } },
};
const EVENTS = ["PAID", "POT_PAID", "MEETING_SCHEDULED", "MEETING_CANCELLED", "CALL_STARTED"] as const;
const WRITTEN = ["TEXT", "VOICE"] as const;
type ChatEvent = (typeof EVENTS)[number];
const isEvent = (e: string | null): e is ChatEvent => EVENTS.includes(e as ChatEvent);

function toMessage(m: Loaded, userId: string, isOrganiser: boolean, now = new Date()): ChatMessage {
  const hidden = m.hiddenAt !== null;
  const written = m.kind === "TEXT" || m.kind === "VOICE";
  return {
    id: m.id,
    kind: m.kind,
    authorId: m.userId,
    authorName: m.author?.displayName ?? null,
    mine: written && m.userId === userId,
    body: hidden ? null : m.body,
    event: isEvent(m.event) ? m.event : null,
    round: m.round,
    meeting: m.meeting
      ? {
          id: m.meeting.id,
          title: m.meeting.title,
          startsAt: m.meeting.startsAt.toISOString(),
          state: stateOf(m.meeting, now),
          instant: m.meeting.instant,
        }
      : null,
    voice: m.kind === "VOICE" ? { durationMs: m.voiceMs ?? 0, available: !hidden && m.voice !== null } : null,
    hidden,
    canHide: written && !hidden && (m.userId === userId || isOrganiser),
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

  await refuseIfRunaway(userId);

  const message = await prisma.groupMessage.create({ data: { groupId, userId, kind: "TEXT", body }, include });
  await prisma.membership.update({ where: { id: seat.id }, data: { chatReadAt: message.createdAt } });
  await notifyChat(groupId, userId, { text: body });
  return toMessage(message, userId, seat.group.organiserId === userId);
}

async function refuseIfRunaway(userId: string) {
  const lastMinute = await prisma.groupMessage.count({
    where: { userId, kind: { in: [...WRITTEN] }, createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (lastMinute >= PER_MINUTE) throw new AppError("RATE_LIMITED", 429);
}

// A voice note: for members who would rather speak than type, as they do at
// the market. The app sends the recording as base64; the server checks its
// length and size, and keeps the sound apart from the message.
export async function postVoice(
  groupId: string,
  userId: string,
  input: { audioBase64: string; durationMs: number; mime: string },
): Promise<ChatMessage> {
  const seat = await seatOf(groupId, userId);
  if (!canWrite(seat)) throw new AppError("NOT_ALLOWED_NOW", 409);
  const mime = input.mime.toLowerCase();
  if (!VOICE_MIMES.includes(mime)) throw new AppError("VALIDATION_FAILED", 400);
  if (!Number.isInteger(input.durationMs) || input.durationMs < 500 || input.durationMs > VOICE_MAX_MS + 1000) {
    throw new AppError("VALIDATION_FAILED", 400);
  }
  const audio = Buffer.from(input.audioBase64, "base64");
  if (audio.length < 200 || audio.length > VOICE_MAX_BYTES) throw new AppError("VALIDATION_FAILED", 400);
  await refuseIfRunaway(userId);

  const message = await prisma.groupMessage.create({
    data: {
      groupId,
      userId,
      kind: "VOICE",
      voiceMs: Math.min(input.durationMs, VOICE_MAX_MS),
      voice: { create: { mime: mime === "audio/x-m4a" || mime === "audio/m4a" ? "audio/mp4" : mime, audio } },
    },
    include,
  });
  await prisma.membership.update({ where: { id: seat.id }, data: { chatReadAt: message.createdAt } });
  await notifyChat(groupId, userId, { voice: true });
  return toMessage(message, userId, seat.group.organiserId === userId);
}

// The sound of one voice note, for a member of its group only.
export async function getVoice(groupId: string, userId: string, messageId: string): Promise<VoiceAudio> {
  await seatOf(groupId, userId);
  const message = await prisma.groupMessage.findFirst({
    where: { id: messageId, groupId, kind: "VOICE" },
    include: { voice: true },
  });
  if (!message) throw new AppError("NOT_FOUND", 404);
  if (!message.voice || message.hiddenAt) throw new AppError("VOICE_EXPIRED", 410);
  return { mime: message.voice.mime, audioBase64: Buffer.from(message.voice.audio).toString("base64") };
}

// When the cycle ends, the voices go: the written story of the group stays.
export async function deleteGroupVoices(groupId: string): Promise<number> {
  const { count } = await prisma.voiceNote.deleteMany({ where: { message: { groupId } } });
  return count;
}

// Hiding keeps the line, without its words: the group sees that a message
// was removed, and by whom it was written, so nothing disappears silently.
export async function hideMessage(groupId: string, userId: string, messageId: string): Promise<ChatMessage> {
  const seat = await seatOf(groupId, userId);
  const isOrganiser = seat.group.organiserId === userId;
  const message = await prisma.groupMessage.findFirst({ where: { id: messageId, groupId } });
  if (!message) throw new AppError("NOT_FOUND", 404);
  if (message.kind === "EVENT" || (message.userId !== userId && !isOrganiser)) {
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }
  // A hidden voice note loses its sound for good.
  await prisma.voiceNote.deleteMany({ where: { messageId } });
  const hidden = await prisma.groupMessage.update({
    where: { id: messageId },
    data: { hiddenAt: message.hiddenAt ?? new Date(), hiddenById: message.hiddenById ?? userId },
    include,
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
