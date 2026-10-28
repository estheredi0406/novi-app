import type { Language } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { push } from "../providers/index.js";
import type { PushMessage } from "../providers/push/PushProvider.js";

// Phone notifications (D79): what reaches a member when Novi is closed.
// Four moments matter: a call starting (so the call brings people in), new
// chat messages (at most one notification an hour per group, so the phone
// does not buzz all day at the market), her pot paid, and a payment due.
// The chat ones can be switched off in "Mon compte"; the money ones cannot.
// A notification never stops what triggered it.

const HOUR_MS = 60 * 60 * 1000;

type Channel = PushMessage["channelId"];
type Text = { title: string; body: string };

// Her phones that can receive a notification now: a token, still trusted,
// and a session that is not over (a phone she logged out of gets nothing).
async function phonesOf(userIds: string[], channel: Channel) {
  if (userIds.length === 0) return [];
  const now = new Date();
  return prisma.device.findMany({
    where: {
      userId: { in: userIds },
      pushToken: { not: null },
      untrustedAt: null,
      user: { closedAt: null, ...(channel === "chat" ? { notifyChat: true } : {}) },
      sessions: { some: { revokedAt: null, expiresAt: { gt: now } } },
    },
    select: { pushToken: true, user: { select: { language: true } } },
  });
}

async function send(userIds: string[], channel: Channel, url: string, text: (language: Language) => Text) {
  try {
    const phones = await phonesOf(userIds, channel);
    await push.send(
      phones.map((p) => ({ to: p.pushToken as string, ...text(p.user.language), data: { url }, channelId: channel })),
    );
  } catch (err) {
    console.error(`Notification (${channel}) not sent:`, err);
  }
}

const groupUrl = (groupId: string, tab?: string) => `/groups/${groupId}${tab ? `?tab=${tab}` : ""}`;
const fcfa = (amount: number) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
const en = (language: Language) => language === "EN"; // Ewe reads French until its texts are checked (D78)

// The group's active members, apart from one person.
async function othersIn(groupId: string, exceptUserId: string | null) {
  const seats = await prisma.membership.findMany({
    where: {
      groupId,
      state: "ACCEPTED",
      exitReason: null,
      ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
    },
    select: { id: true, userId: true, chatReadAt: true, chatPushedAt: true },
  });
  return seats;
}

// "Akossiwa appelle le groupe": everyone but the caller.
export async function notifyCall(groupId: string, callerId: string): Promise<void> {
  const [group, caller, seats] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: callerId }, select: { displayName: true } }),
    othersIn(groupId, callerId),
  ]);
  if (!group || !caller) return;
  await send(
    seats.map((s) => s.userId),
    "calls",
    groupUrl(groupId, "discussion"),
    (l) =>
      en(l)
        ? { title: `${caller.displayName} is calling ${group.name}`, body: "Tap to join the call." }
        : { title: `${caller.displayName} appelle ${group.name}`, body: "Touchez pour rejoindre l'appel." },
  );
}

// A new message: one notification an hour at most per member and group, and
// none to a member who has the chat open (read in the last two minutes).
export async function notifyChat(
  groupId: string,
  authorId: string,
  preview: { text: string } | { voice: true },
  now = new Date(),
): Promise<void> {
  try {
    const [group, author, seats] = await Promise.all([
      prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: authorId }, select: { displayName: true } }),
      othersIn(groupId, authorId),
    ]);
    if (!group || !author) return;
    const due = seats.filter(
      (s) =>
        (!s.chatPushedAt || now.getTime() - s.chatPushedAt.getTime() >= HOUR_MS) &&
        (!s.chatReadAt || now.getTime() - s.chatReadAt.getTime() >= 2 * 60 * 1000),
    );
    if (due.length === 0) return;
    await prisma.membership.updateMany({ where: { id: { in: due.map((s) => s.id) } }, data: { chatPushedAt: now } });
    const words = "text" in preview ? preview.text.slice(0, 90) : null;
    await send(
      due.map((s) => s.userId),
      "chat",
      groupUrl(groupId, "discussion"),
      (l) => ({
        title: group.name,
        body: words
          ? `${author.displayName} : ${words}`
          : en(l)
            ? `${author.displayName} sent a voice note`
            : `${author.displayName} a envoyé un message vocal`,
      }),
    );
  } catch (err) {
    console.error("Chat notification not sent:", err);
  }
}

// Her pot reached her mobile money.
export async function notifyPotPaid(userId: string, groupId: string, groupName: string, amountFcfa: number) {
  await send([userId], "money", groupUrl(groupId, "cotisation"), (l) =>
    en(l)
      ? { title: `Your pot of ${fcfa(amountFcfa)} was sent`, body: `${groupName}: tell your group when it arrives.` }
      : { title: `Votre cagnotte de ${fcfa(amountFcfa)} est envoyée`, body: `${groupName} : dites au groupe quand elle arrive.` },
  );
}

// The day before, and the morning of, a payment she has not made yet.
export async function notifyDue(userId: string, groupId: string, groupName: string, amountFcfa: number, dueToday: boolean) {
  await send([userId], "money", groupUrl(groupId, "cotisation"), (l) =>
    en(l)
      ? { title: `${fcfa(amountFcfa)} due ${dueToday ? "today" : "tomorrow"}`, body: `${groupName}: tap to pay.` }
      : { title: `Cotisation de ${fcfa(amountFcfa)} ${dueToday ? "aujourd'hui" : "demain"}`, body: `${groupName} : touchez pour payer.` },
  );
}

// D80: the last pot is paid; each member says whether she goes again.
export async function notifyCycleDone(groupId: string): Promise<void> {
  const [group, seats] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
    othersIn(groupId, null),
  ]);
  if (!group) return;
  await send(
    seats.map((s) => s.userId),
    "money",
    groupUrl(groupId, "cotisation"),
    (l) =>
      en(l)
        ? { title: `${group.name}: cycle complete`, body: "Everyone has received her pot. Going again?" }
        : { title: `${group.name} : cycle terminé`, body: "Chacune a reçu sa cagnotte. On continue ?" },
  );
}

// The phone tells Novi where to reach it, after login; null after logout.
export async function savePushToken(sessionId: string, token: string | null): Promise<void> {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { deviceId: true } });
  if (!session) return;
  if (token) {
    // A token belongs to one phone: if another account used this phone
    // before, it stops receiving here.
    await prisma.device.updateMany({ where: { pushToken: token, id: { not: session.deviceId } }, data: { pushToken: null } });
  }
  await prisma.device.update({ where: { id: session.deviceId }, data: { pushToken: token } });
}
