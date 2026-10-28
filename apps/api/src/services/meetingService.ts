import type { GroupCall, GroupMeetingView, MeetingState, MeetingsPage } from "@novi/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { holdsSeat } from "../lib/groupRules.js";
import { meetings } from "../providers/index.js";

// Group meetings (D71). The organiser schedules a call: a title, a date and
// time, a length and what will be discussed. Novi asks the video provider
// for a private room that opens 10 minutes before and closes at the end,
// and posts the meeting in the group's chat. Each member who joins gets a
// personal pass, valid only for that room and that meeting, with her display
// name: the address alone lets nobody in. Nothing is recorded, and the MFI
// does not see meetings (D33).

export const OPENS_BEFORE_MS = 10 * 60 * 1000;
const MINUTE = 60 * 1000;
const DURATIONS = [15, 30, 45, 60];
const MAX_AHEAD_DAYS = 60;
const MAX_UPCOMING = 5;
const PAST_DAYS = 30;
// "Appeler le groupe": an instant call lasts at most this long.
const CALL_MIN = 30;

type Loaded = Prisma.GroupMeetingGetPayload<{
  include: { createdBy: { select: { displayName: true } }; attendances: { include: { user: { select: { displayName: true } } } } };
}>;
const include = {
  createdBy: { select: { displayName: true } },
  attendances: { include: { user: { select: { displayName: true } } }, orderBy: { firstJoinedAt: "asc" as const } },
};

const endOf = (m: { startsAt: Date; durationMin: number }) => new Date(m.startsAt.getTime() + m.durationMin * MINUTE);

export function stateOf(m: { startsAt: Date; durationMin: number; cancelledAt: Date | null }, now: Date): MeetingState {
  if (m.cancelledAt) return "CANCELLED";
  if (now >= endOf(m)) return "ENDED";
  if (now.getTime() >= m.startsAt.getTime() - OPENS_BEFORE_MS) return "OPEN";
  return "UPCOMING";
}

async function seatOf(groupId: string, userId: string) {
  const seat = await prisma.membership.findUnique({
    where: { groupId_userId: { groupId, userId } },
    include: {
      group: { select: { state: true, organiserId: true, rulesVersions: true, currentVersion: true } },
      user: { select: { displayName: true, language: true, closedAt: true } },
    },
  });
  if (!seat || !holdsSeat(seat)) throw new AppError("NOT_FOUND", 404);
  return seat;
}

const active = (seat: Awaited<ReturnType<typeof seatOf>>) =>
  seat.exitReason === null && seat.user.closedAt === null && seat.group.state !== "CANCELLED";

// The organiser may plan meetings from the moment the group is proposed
// (to talk the rules through) until the cycle ends.
const canSchedule = (seat: Awaited<ReturnType<typeof seatOf>>) =>
  active(seat) &&
  seat.group.organiserId === seat.userId &&
  ["PROPOSED", "STARTING", "ACTIVE"].includes(seat.group.state);

function toView(m: Loaded, userId: string, isOrganiser: boolean, now: Date): GroupMeetingView {
  const state = stateOf(m, now);
  return {
    id: m.id,
    title: m.title,
    agenda: m.agenda,
    startsAt: m.startsAt.toISOString(),
    endsAt: endOf(m).toISOString(),
    durationMin: m.durationMin,
    state,
    createdByName: m.createdBy.displayName,
    joined: m.attendances.map((a) => a.user.displayName),
    canCancel: isOrganiser && (state === "UPCOMING" || state === "OPEN"),
  };
}

export async function listMeetings(groupId: string, userId: string, now = new Date()): Promise<MeetingsPage> {
  const seat = await seatOf(groupId, userId);
  const isOrganiser = seat.group.organiserId === userId;
  const rows = await prisma.groupMeeting.findMany({
    where: { groupId, instant: false, startsAt: { gte: new Date(now.getTime() - PAST_DAYS * 24 * 60 * MINUTE) } },
    orderBy: { startsAt: "asc" },
    include,
  });
  const views = rows.map((m) => toView(m, userId, isOrganiser, now));
  return {
    upcoming: views.filter((v) => v.state === "UPCOMING" || v.state === "OPEN"),
    past: views.filter((v) => v.state === "ENDED" || v.state === "CANCELLED").reverse(),
    canSchedule: canSchedule(seat),
  };
}

export async function scheduleMeeting(
  groupId: string,
  userId: string,
  input: { title: string; agenda?: string | null; startsAt: Date; durationMin: number },
  now = new Date(),
): Promise<GroupMeetingView> {
  const seat = await seatOf(groupId, userId);
  if (!canSchedule(seat)) throw new AppError("NOT_ALLOWED_NOW", 409);
  if (!DURATIONS.includes(input.durationMin)) throw new AppError("VALIDATION_FAILED", 400);

  const startsAt = input.startsAt;
  const endsAt = endOf({ startsAt, durationMin: input.durationMin });
  if (startsAt.getTime() < now.getTime() + 5 * MINUTE) throw new AppError("MEETING_TIME_INVALID", 409);
  if (startsAt.getTime() > now.getTime() + MAX_AHEAD_DAYS * 24 * 60 * MINUTE) {
    throw new AppError("MEETING_TIME_INVALID", 409);
  }

  const planned = await prisma.groupMeeting.findMany({
    where: { groupId, instant: false, cancelledAt: null, startsAt: { gte: new Date(now.getTime() - 60 * MINUTE) } },
  });
  const still = planned.filter((m) => endOf(m) > now);
  if (still.length >= MAX_UPCOMING) throw new AppError("MEETING_LIMIT", 409);
  // Two meetings of the same group never overlap.
  if (still.some((m) => m.startsAt < endsAt && endOf(m) > startsAt)) {
    throw new AppError("MEETING_TIME_INVALID", 409);
  }

  // The room holds the whole group, and no one else.
  const size = seat.group.rulesVersions.find((v) => v.version === seat.group.currentVersion)?.size ?? 15;
  const meeting = await prisma.groupMeeting.create({
    data: {
      groupId,
      createdById: userId,
      title: input.title,
      agenda: input.agenda?.trim() || null,
      startsAt,
      durationMin: input.durationMin,
    },
  });
  try {
    const room = await meetings.createRoom({
      name: `novi-${meeting.id}`,
      opensAt: new Date(startsAt.getTime() - OPENS_BEFORE_MS),
      closesAt: endsAt,
      maxParticipants: size,
    });
    await prisma.groupMeeting.update({ where: { id: meeting.id }, data: { roomName: room.name, roomUrl: room.url } });
  } catch (err) {
    // No room, no meeting: nothing is left half-made.
    console.error("Meeting room not created:", err);
    await prisma.groupMeeting.delete({ where: { id: meeting.id } });
    throw new AppError("MEETING_UNAVAILABLE", 503);
  }

  await prisma.$transaction([
    prisma.groupMessage.create({
      data: { groupId, userId, kind: "EVENT", event: "MEETING_SCHEDULED", meetingId: meeting.id },
    }),
    prisma.auditEvent.create({ data: { userId, type: "MEETING_SCHEDULED", details: { groupId, meetingId: meeting.id } } }),
  ]);
  const loaded = await prisma.groupMeeting.findUniqueOrThrow({ where: { id: meeting.id }, include });
  return toView(loaded, userId, true, now);
}

export async function cancelMeeting(groupId: string, userId: string, meetingId: string, now = new Date()) {
  const seat = await seatOf(groupId, userId);
  if (seat.group.organiserId !== userId) throw new AppError("NOT_ALLOWED_NOW", 409);
  const meeting = await prisma.groupMeeting.findFirst({ where: { id: meetingId, groupId } });
  if (!meeting) throw new AppError("NOT_FOUND", 404);
  const state = stateOf(meeting, now);
  if (state !== "UPCOMING" && state !== "OPEN") throw new AppError("NOT_ALLOWED_NOW", 409);

  await prisma.$transaction([
    prisma.groupMeeting.update({ where: { id: meetingId }, data: { cancelledAt: now } }),
    prisma.groupMessage.create({
      data: { groupId, userId, kind: "EVENT", event: "MEETING_CANCELLED", meetingId },
    }),
    prisma.auditEvent.create({ data: { userId, type: "MEETING_CANCELLED", details: { groupId, meetingId } } }),
  ]);
  // The room is closed at the provider too, so no pass can open it.
  if (meeting.roomName) {
    await meetings.deleteRoom(meeting.roomName).catch((err: unknown) => console.error("Room not deleted:", err));
  }
  return listMeetings(groupId, userId, now);
}

// Her pass to the room: only while it is open, only for the group's active
// members. The organiser joins as the room's owner, so she can mute or
// remove someone if needed.
export async function joinMeeting(
  groupId: string,
  userId: string,
  meetingId: string,
  now = new Date(),
): Promise<{ url: string }> {
  const seat = await seatOf(groupId, userId);
  if (!active(seat)) throw new AppError("NOT_ALLOWED_NOW", 409);
  const meeting = await prisma.groupMeeting.findFirst({ where: { id: meetingId, groupId } });
  if (!meeting) throw new AppError("NOT_FOUND", 404);
  if (stateOf(meeting, now) !== "OPEN" || !meeting.roomName || !meeting.roomUrl) {
    throw new AppError("MEETING_NOT_OPEN", 409);
  }

  let url: string;
  try {
    url = await meetings.joinUrl({
      roomName: meeting.roomName,
      roomUrl: meeting.roomUrl,
      userId,
      userName: seat.user.displayName,
      isOwner: seat.group.organiserId === userId,
      closesAt: endOf(meeting),
      lang: seat.user.language === "EN" ? "en" : "fr",
    });
  } catch (err) {
    console.error("Meeting pass not issued:", err);
    throw new AppError("MEETING_UNAVAILABLE", 503);
  }
  await prisma.meetingAttendance.upsert({
    where: { meetingId_userId: { meetingId, userId } },
    create: { meetingId, userId, firstJoinedAt: now },
    update: {},
  });
  return { url };
}

// "Appeler le groupe" (D76): any active member calls the whole group now, as
// she would ring her neighbours. If a call or a meeting is already open, she
// joins it instead of opening a second room. A new call is posted in the
// chat ("Akossiwa a lancé un appel · Rejoindre") and ends after 30 minutes.
export async function startCall(groupId: string, userId: string, now = new Date()): Promise<GroupCall> {
  const seat = await seatOf(groupId, userId);
  if (!active(seat) || !["PROPOSED", "STARTING", "ACTIVE"].includes(seat.group.state)) {
    throw new AppError("NOT_ALLOWED_NOW", 409);
  }

  const recent = await prisma.groupMeeting.findMany({
    where: { groupId, cancelledAt: null, startsAt: { gte: new Date(now.getTime() - 60 * MINUTE), lte: new Date(now.getTime() + OPENS_BEFORE_MS) } },
    orderBy: { startsAt: "desc" },
  });
  const open = recent.find((m) => stateOf(m, now) === "OPEN" && m.roomName);
  if (open) return { meetingId: open.id, ...(await joinMeeting(groupId, userId, open.id, now)) };

  const size = seat.group.rulesVersions.find((v) => v.version === seat.group.currentVersion)?.size ?? 15;
  const call = await prisma.groupMeeting.create({
    data: { groupId, createdById: userId, title: "", startsAt: now, durationMin: CALL_MIN, instant: true },
  });
  try {
    const room = await meetings.createRoom({
      name: `novi-${call.id}`,
      opensAt: new Date(now.getTime() - MINUTE),
      closesAt: endOf(call),
      maxParticipants: size,
    });
    await prisma.groupMeeting.update({ where: { id: call.id }, data: { roomName: room.name, roomUrl: room.url } });
  } catch (err) {
    console.error("Call room not created:", err);
    await prisma.groupMeeting.delete({ where: { id: call.id } });
    throw new AppError("MEETING_UNAVAILABLE", 503);
  }
  await prisma.$transaction([
    prisma.groupMessage.create({ data: { groupId, userId, kind: "EVENT", event: "CALL_STARTED", meetingId: call.id } }),
    prisma.auditEvent.create({ data: { userId, type: "CALL_STARTED", details: { groupId, meetingId: call.id } } }),
  ]);
  return { meetingId: call.id, ...(await joinMeeting(groupId, userId, call.id, now)) };
}
