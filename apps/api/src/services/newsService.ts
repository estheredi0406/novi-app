import type { NewsItem, Statement, StatementLine } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { potShare } from "../lib/groupRules.js";

// D92: home's "Dernières nouvelles" and the bell gather the money and meeting
// lines of all her groups' chats, so she sees what moved without opening each
// group. Only groups she holds a seat in; only the last 30 days.

const NEWS_EVENTS = ["PAID", "POT_PAID", "TURN_SWAPPED", "MEETING_SCHEDULED", "CALL_STARTED"] as const;
type NewsEvent = (typeof NEWS_EVENTS)[number];
const DAY_MS = 24 * 60 * 60 * 1000;

export async function listNews(userId: string, limit = 30, now = new Date()): Promise<NewsItem[]> {
  // Only groups she joined: an invited member does not see a group's money.
  const seats = await prisma.membership.findMany({
    where: { userId, state: "ACCEPTED", group: { state: { not: "CANCELLED" } } },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          currentVersion: true,
          rulesVersions: { select: { version: true, amountFcfa: true, size: true } },
        },
      },
    },
  });
  const groups = seats.map((s) => s.group);
  if (groups.length === 0) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));

  const lines = await prisma.groupMessage.findMany({
    where: {
      groupId: { in: groups.map((g) => g.id) },
      kind: "EVENT",
      event: { in: [...NEWS_EVENTS] },
      createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    include: {
      author: { select: { displayName: true } },
      meeting: { select: { startsAt: true } },
    },
  });

  return lines.map((m) => {
    const group = byId.get(m.groupId);
    const rules = group?.rulesVersions.find((r) => r.version === group.currentVersion);
    const event = m.event as NewsEvent;
    const amountFcfa =
      rules && event === "PAID"
        ? rules.amountFcfa
        : rules && event === "POT_PAID"
          ? potShare(rules.amountFcfa) * rules.size
          : null;
    return {
      id: m.id,
      groupId: m.groupId,
      groupName: group?.name ?? "",
      event,
      who: m.author?.displayName ?? null,
      mine: m.userId === userId,
      round: m.round,
      amountFcfa,
      meetingStartsAt: m.meeting?.startsAt.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

// Her own money, line by line: every payment she made (on time or late) and
// every pot she received. The record (D50) gives the totals; this gives the
// lines behind them, for her eyes only.
export async function getStatement(userId: string, limit = 200): Promise<Statement> {
  const [paid, received] = await Promise.all([
    prisma.contribution.findMany({
      where: { userId, status: "PAID" },
      orderBy: { paidAt: "desc" },
      take: limit,
      include: { round: { select: { number: true, dueDate: true, group: { select: { name: true } } } } },
    }),
    prisma.payout.findMany({
      where: { beneficiaryId: userId, status: "PAID" },
      orderBy: { paidAt: "desc" },
      take: limit,
      include: { round: { select: { number: true, group: { select: { name: true } } } } },
    }),
  ]);
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  const lines: StatementLine[] = [
    ...paid.map((c) => ({
      id: c.id,
      kind: "PAID" as const,
      groupName: c.round.group.name,
      round: c.round.number,
      amountFcfa: c.amountFcfa,
      at: (c.paidAt ?? c.requestedAt).toISOString(),
      onTime: c.paidAt ? day(c.paidAt) <= day(c.round.dueDate) : null,
    })),
    ...received.map((p) => ({
      id: p.id,
      kind: "RECEIVED" as const,
      groupName: p.round.group.name,
      round: p.round.number,
      amountFcfa: p.amountFcfa,
      at: (p.paidAt ?? p.updatedAt).toISOString(),
      onTime: null,
    })),
  ];
  lines.sort((a, b) => b.at.localeCompare(a.at));
  return { lines: lines.slice(0, limit) };
}
