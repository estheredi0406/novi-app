import type { NewsItem, Statement, StatementLine } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { advanceOf, potShare } from "../lib/groupRules.js";

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
        ? // D118: round 1 includes her advance, so the news shows what she paid.
          rules.amountFcfa + (m.round === 1 ? advanceOf(rules.amountFcfa) : 0)
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

// Her own money, line by line ("Mes transactions"): every payment she made
// (on time or late, pending or not confirmed), her advance, every pot and
// advance given back, and every share the group's advances paid for her
// (D103, D104). The record (D50) gives the totals; this gives the lines
// behind them, for her eyes only.
export async function getStatement(userId: string, limit = 200): Promise<Statement> {
  const group = { select: { id: true, name: true } };
  const [contributions, received, covers, returns] = await Promise.all([
    prisma.contribution.findMany({
      where: { userId, status: { in: ["PAID", "PENDING", "FAILED"] } },
      orderBy: { requestedAt: "desc" },
      take: limit,
      include: { round: { select: { number: true, dueDate: true, group } } },
    }),
    prisma.payout.findMany({
      where: { beneficiaryId: userId, status: "PAID" },
      orderBy: { paidAt: "desc" },
      take: limit,
      include: { round: { select: { number: true, group } } },
    }),
    prisma.reserveCover.findMany({
      where: { userId },
      orderBy: { coveredAt: "desc" },
      take: limit,
      include: { round: { select: { number: true, group } } },
    }),
    prisma.reserveReturn.findMany({
      where: { userId, status: "PAID" },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { group: { select: { id: true, name: true } } },
    }),
  ]);
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // A failed attempt for a round she paid in the end is no longer news.
  const paidRounds = new Set(contributions.filter((c) => c.status === "PAID").map((c) => c.roundId));

  const lines: StatementLine[] = [];
  for (const c of contributions) {
    const base = { groupId: c.round.group.id, groupName: c.round.group.name, round: c.round.number };
    if (c.status === "PAID") {
      const at = (c.paidAt ?? c.requestedAt).toISOString();
      lines.push({
        ...base,
        id: c.id,
        kind: "PAID",
        // D118: one line, the amount she paid; her advance is shown inside it.
        amountFcfa: c.amountFcfa,
        advanceFcfa: c.advanceFcfa,
        at,
        onTime: c.paidAt ? day(c.paidAt) <= day(c.round.dueDate) : null,
      });
    } else if (c.status === "PENDING") {
      lines.push({ ...base, id: c.id, kind: "PENDING", amountFcfa: c.amountFcfa, at: c.requestedAt.toISOString(), onTime: null });
    } else if (!paidRounds.has(c.roundId)) {
      lines.push({
        ...base,
        id: c.id,
        kind: "FAILED",
        amountFcfa: c.amountFcfa,
        at: (c.failedAt ?? c.requestedAt).toISOString(),
        onTime: null,
        reported: c.reportedAt !== null,
      });
    }
  }
  for (const p of received) {
    lines.push({
      id: p.id,
      kind: "RECEIVED",
      groupId: p.round.group.id,
      groupName: p.round.group.name,
      round: p.round.number,
      amountFcfa: p.amountFcfa,
      at: (p.paidAt ?? p.updatedAt).toISOString(),
      onTime: null,
    });
  }
  for (const cover of covers) {
    if (cover.writtenOffAt) continue;
    lines.push({
      id: cover.id,
      kind: "COVERED",
      groupId: cover.round.group.id,
      groupName: cover.round.group.name,
      round: cover.round.number,
      amountFcfa: cover.amountFcfa,
      at: cover.coveredAt.toISOString(),
      onTime: null,
      dueBy: cover.dueBy?.toISOString() ?? null,
      repaid: cover.repaidAt !== null,
    });
  }
  for (const r of returns) {
    lines.push({
      id: r.id,
      kind: "ADVANCE_BACK",
      groupId: r.group.id,
      groupName: r.group.name,
      round: 0,
      amountFcfa: r.amountFcfa,
      at: (r.paidAt ?? r.createdAt).toISOString(),
      onTime: null,
    });
  }
  lines.sort((a, b) => b.at.localeCompare(a.at));
  return { lines: lines.slice(0, limit) };
}
