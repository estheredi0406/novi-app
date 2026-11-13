import type { ConsoleCompliance, ConsoleGroupDetail, ConsoleRoundPayments, ConsoleSeat } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { potShare } from "../lib/groupRules.js";
import { isoDay } from "../lib/schedule.js";
import { hasApp } from "./notifyService.js";

// D117: what the group page (board 12) adds to the group's totals: each seat
// by its turn, the payments of one round, and the group's history. Never a
// member's name (D33): names are in the compliance view only, below.

const OPERATOR: Record<string, string> = { MOOV_TG: "Flooz", TOGOCEL: "Mixx by Yas" };
const operatorName = (o: string) => OPERATOR[o] ?? o;
const cleanRef = (ref: string | null) => (ref ? ref.replace(/^fedapay:/, "") : null);

async function loadGroup(mfiId: string, groupId: string) {
  const group = await prisma.group.findFirst({
    where: { id: groupId, mfiId },
    include: {
      rulesVersions: true,
      memberships: { where: { payoutPosition: { not: null } } },
      reserveReturns: true,
      rounds: {
        orderBy: { number: "asc" },
        include: { contributions: true, payout: true, reserveCovers: true },
      },
    },
  });
  if (!group) throw new AppError("NOT_FOUND", 404);
  const rules = group.rulesVersions.find((r) => r.version === group.currentVersion) ?? group.rulesVersions.at(-1);
  if (!rules) throw new Error(`group ${groupId} has no rules`);
  return { group, rules };
}
type Loaded = Awaited<ReturnType<typeof loadGroup>>;

const receiptOf = (p: { receiptConfirmedAt: Date | null; receiptDisputedAt: Date | null } | null) =>
  p?.receiptDisputedAt ? ("DISPUTED" as const) : p?.receiptConfirmedAt ? ("CONFIRMED" as const) : null;

function seatsOf({ group }: Loaded, now: Date): ConsoleSeat[] {
  const today = isoDay(now);
  const due = group.rounds.filter((r) => isoDay(r.dueDate) < today);
  return group.memberships
    .slice()
    .sort((a, b) => (a.payoutPosition ?? 0) - (b.payoutPosition ?? 0))
    .map((seat) => {
      const turn = seat.payoutPosition as number;
      const mine = (r: Loaded["group"]["rounds"][number]) =>
        r.contributions.find((c) => c.userId === seat.userId && c.status === "PAID");
      const paidDue = due.map(mine).filter(Boolean);
      const onTime = due.filter((r) => {
        const c = mine(r);
        return c?.paidAt && isoDay(c.paidAt) <= isoDay(r.dueDate);
      }).length;
      const covers = group.rounds.flatMap((r) => r.reserveCovers).filter((c) => c.userId === seat.userId);
      const open = covers.filter((c) => !c.repaidAt && !c.writtenOffAt);
      const firstDue = open
        .map((c) => c.dueBy)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      const round = group.rounds.find((r) => r.number === turn);
      const first = group.rounds[0];
      return {
        turn,
        organiser: seat.userId === group.organiserId,
        advanceFcfa: (first && mine(first)?.advanceFcfa) || 0,
        paidOnTime: onTime,
        roundsDue: due.length,
        paid: paidDue.length,
        owedFcfa: open.reduce((n, c) => n + c.amountFcfa, 0),
        owedBy: firstDue ? isoDay(firstDue) : null,
        reported: group.rounds.some((r) =>
          r.contributions.some((c) => c.userId === seat.userId && c.reportedAt && c.status !== "PAID"),
        ),
        defaulted: seat.defaultedAt !== null,
        left: seat.exitedAt !== null,
        pot: {
          status: round?.payout?.status ?? "NOT_DUE",
          date: isoDay(round?.payout?.paidAt ?? round?.dueDate ?? now),
          receipt: receiptOf(round?.payout ?? null),
        },
        advanceBack: (() => {
          const back = group.reserveReturns.find((r) => r.userId === seat.userId);
          return back ? { amountFcfa: back.amountFcfa, status: back.status } : null;
        })(),
      };
    });
}

function roundPayments({ group, rules }: Loaded, number: number): ConsoleRoundPayments | null {
  const round = group.rounds.find((r) => r.number === number);
  if (!round) return null;
  const paidBy = new Set(round.contributions.filter((c) => c.status === "PAID").map((c) => c.userId));
  const payout = round.payout;
  return {
    number: round.number,
    dueDate: isoDay(round.dueDate),
    payments: round.contributions
      .slice()
      .sort((a, b) => (a.paidAt ?? a.requestedAt).getTime() - (b.paidAt ?? b.requestedAt).getTime())
      .map((c) => ({
        at: (c.paidAt ?? c.requestedAt).toISOString(),
        operator: operatorName(c.operator),
        amountFcfa: c.amountFcfa,
        status: c.status,
        reported: c.reportedAt !== null && c.status !== "PAID",
        providerRef: c.providerRef,
      })),
    coveredFcfa: round.reserveCovers.filter((c) => !paidBy.has(c.userId)).map((c) => c.amountFcfa),
    pot: payout
      ? {
          amountFcfa: payout.amountFcfa,
          status: payout.status,
          at: (payout.paidAt ?? payout.releasedAt ?? payout.requestedAt)?.toISOString() ?? null,
          auto: payout.releasedAt !== null && payout.releasedById === null,
          via: payout.sentVia,
          ref: cleanRef(payout.mfiRef),
          receipt: receiptOf(payout),
        }
      : null,
    expectedFcfa: potShare(rules.amountFcfa) * rules.size,
  };
}

async function historyOf({ group }: Loaded) {
  const events: { at: Date; event: string; by: string | null; round: number | null }[] = [
    { at: group.createdAt, event: "CREATED", by: null, round: null },
  ];
  const approved = await prisma.auditEvent.findFirst({
    where: { type: "STAFF_GROUP_APPROVED", details: { path: ["groupId"], equals: group.id } },
    orderBy: { createdAt: "asc" },
  });
  if (approved) {
    const staffId = (approved.details as { staffId?: string } | null)?.staffId;
    const staff = staffId ? await prisma.staffUser.findUnique({ where: { id: staffId }, select: { name: true } }) : null;
    events.push({ at: approved.createdAt, event: "VALIDATED", by: staff?.name ?? null, round: null });
  }
  if (group.startedAt) events.push({ at: group.startedAt, event: "STARTED", by: null, round: null });
  for (const r of group.rounds) {
    if (r.reserveCovers.length > 0)
      events.push({ at: r.reserveCovers[0]!.coveredAt, event: `COVERED:${r.reserveCovers.length}`, by: null, round: r.number });
    if (r.payout?.receiptDisputedAt) events.push({ at: r.payout.receiptDisputedAt, event: "DISPUTED", by: null, round: r.number });
    for (const c of r.contributions)
      if (c.escalatedAt) events.push({ at: c.escalatedAt, event: "REPORTED", by: null, round: r.number });
  }
  if (group.completedAt) events.push({ at: group.completedAt, event: "COMPLETED", by: null, round: null });
  return events
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((e) => ({ ...e, at: e.at.toISOString() }));
}

export async function groupPageExtras(
  mfiId: string,
  groupId: string,
  currentRound: number | null,
  now = new Date(),
): Promise<Pick<ConsoleGroupDetail, "payoutOrder" | "advancesInFcfa" | "seats" | "shownRound" | "history">> {
  const loaded = await loadGroup(mfiId, groupId);
  const { group, rules } = loaded;
  const shown = currentRound ?? group.rounds.filter((r) => r.contributions.length > 0).at(-1)?.number ?? null;
  return {
    payoutOrder: rules.payoutOrder,
    advancesInFcfa: group.rounds
      .flatMap((r) => r.contributions)
      .filter((c) => c.status === "PAID")
      .reduce((n, c) => n + c.advanceFcfa, 0),
    seats: seatsOf(loaded, now),
    shownRound: shown ? roundPayments(loaded, shown) : null,
    history: await historyOf(loaded),
  };
}

// D117: one round's payments, for the round picker on the group page.
export async function groupRound(mfiId: string, groupId: string, number: number): Promise<ConsoleRoundPayments> {
  const found = roundPayments(await loadGroup(mfiId, groupId), number);
  if (!found) throw new AppError("NOT_FOUND", 404);
  return found;
}

// ---------- D117: the compliance view ----------

export const COMPLIANCE_MINUTES = 15;

export async function openCompliance(
  mfiId: string,
  staff: { staffId: string; role: string },
  groupId: string,
  reason: string,
  now = new Date(),
): Promise<ConsoleCompliance> {
  if (staff.role !== "ADMIN" && staff.role !== "COMPLIANCE") throw new AppError("COMPLIANCE_ONLY", 403);
  const { group } = await loadGroup(mfiId, groupId);
  await prisma.auditEvent.create({
    data: { type: "STAFF_COMPLIANCE_OPENED", details: { staffId: staff.staffId, groupId, reason } },
  });
  const all = await prisma.membership.findMany({
    where: { groupId },
    include: { user: { select: { legalName: true, phone: true, idVerifiedAt: true } } },
  });
  const members = await Promise.all(
    all
      .filter((m) => m.payoutPosition !== null || m.userId === group.organiserId)
      .sort((a, b) => (a.payoutPosition ?? 99) - (b.payoutPosition ?? 99))
      .map(async (m) => ({
        turn: m.payoutPosition,
        organiser: m.userId === group.organiserId,
        legalName: m.user.legalName,
        identityVerifiedAt: m.user.idVerifiedAt.toISOString(),
        phone: m.user.phone,
        channel: (await hasApp(m.userId, now)) ? ("APP" as const) : ("USSD" as const),
        recordShared: m.shareConsentAt ? true : null,
        left: m.exitedAt !== null,
      })),
  );
  const byUser = new Map(all.map((m) => [m.userId, m]));
  return {
    openedAt: now.toISOString(),
    closesAt: new Date(now.getTime() + COMPLIANCE_MINUTES * 60_000).toISOString(),
    reason,
    members,
    rounds: group.rounds
      .filter((r) => r.contributions.length > 0 || r.reserveCovers.length > 0)
      .map((r) => ({
        number: r.number,
        dueDate: isoDay(r.dueDate),
        payments: r.contributions
          .slice()
          .sort((a, b) => (a.paidAt ?? a.requestedAt).getTime() - (b.paidAt ?? b.requestedAt).getTime())
          .map((c) => ({
            at: (c.paidAt ?? c.requestedAt).toISOString(),
            legalName: byUser.get(c.userId)?.user.legalName ?? "",
            turn: byUser.get(c.userId)?.payoutPosition ?? null,
            operator: operatorName(c.operator),
            amountFcfa: c.amountFcfa,
            status: c.status,
            reported: c.reportedAt !== null && c.status !== "PAID",
            providerRef: c.providerRef,
          })),
        covered: r.reserveCovers.map((c) => ({
          legalName: byUser.get(c.userId)?.user.legalName ?? "",
          amountFcfa: c.amountFcfa,
        })),
      })),
  };
}

export async function closeCompliance(staffId: string, groupId: string): Promise<void> {
  await prisma.auditEvent.create({ data: { type: "STAFF_COMPLIANCE_CLOSED", details: { staffId, groupId } } });
}
