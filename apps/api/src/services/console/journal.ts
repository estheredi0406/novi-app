// The journal of what the officers did (D67).

import type { ConsoleActivity } from "@novi/shared";
import { prisma } from "../../lib/db.js";

const ACTIVITY: Record<ConsoleActivity["action"], ConsoleActivity["category"]> = {
  STAFF_GROUP_APPROVED: "GROUPS",
  STAFF_GROUP_DECLINED: "GROUPS",
  STAFF_DEMO_DUE: "GROUPS",
  STAFF_PAYOUT_RELEASED: "MONEY",
  STAFF_PAYOUT_RETRY: "MONEY",
  STAFF_ADVANCE_SENT: "MONEY",
  STAFF_PAYOUT_APPROVED: "MONEY",
  STAFF_PAYMENT_FOUND: "MONEY",
  STAFF_PAYMENT_NOT_FOUND: "MONEY",
  STAFF_AUTO_RELEASE_SET: "MONEY",
  STAFF_PAYMENT_ACCOUNT_CONNECTED: "MONEY",
  STAFF_PAYMENT_ACCOUNT_DISCONNECTED: "MONEY",
  STAFF_PAYOUTS_ROUTE_SET: "MONEY",
  STAFF_COMPLIANCE_OPENED: "MEMBERS", // D117
  STAFF_COMPLIANCE_CLOSED: "MEMBERS",
  STAFF_RECORD_OPENED: "CREDIT",
  STAFF_CREDIT_POLICY_CHANGED: "CREDIT",
  STAFF_MISMATCH_RESOLVED: "MONEY",
  STAFF_SAVINGS_OPENED: "MONEY",
  STAFF_SAVINGS_REFUSED: "MONEY",
  STAFF_SAVINGS_POLICY_CHANGED: "MONEY",
  STAFF_LOAN_PRESELECT: "CREDIT",
  STAFF_LOAN_DECLINE: "CREDIT",
  STAFF_LOAN_GRANT: "CREDIT",
  STAFF_LOAN_NOTGRANTED: "CREDIT",
  STAFF_LOAN_DOCUMENT_VIEWED: "CREDIT",
  STAFF_LOAN_DOCUMENT_REVIEWED: "CREDIT",
  STAFF_MEMBER_LOOKUP: "MEMBERS",
  STAFF_MEMBER_EXIT: "MEMBERS",
  STAFF_PHONE_CHANGED: "MEMBERS",
  STAFF_ORGANISER_CHANGED: "MEMBERS",
  STAFF_ADDED: "TEAM",
  STAFF_DEACTIVATED: "TEAM",
  STAFF_REACTIVATED: "TEAM",
  STAFF_ACCESS_RESET: "TEAM",
};

const ACTIVITY_LABELS = Object.keys(ACTIVITY) as ConsoleActivity["action"][];

type AuditDetails = {
  staffId?: string;
  round?: number;
  groupId?: string;
  payoutId?: string;
  advanceId?: string;
  loanId?: string;
  userId?: string;
  key?: string;
  accepted?: boolean;
  reason?: string;
};

// Every action taken by this MFI's officers, newest first: who did what, to
// which group or member, and when (D67). Opening a shared record is included
// (each opening is logged, D54), and so is every credit step (D91, D92).
export async function listActivity(
  mfiId: string,
  limit = 100,
): Promise<ConsoleActivity[]> {
  const staff = await prisma.staffUser.findMany({
    where: { mfiId },
    select: { id: true, name: true },
  });
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const [events, views] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { type: { in: ACTIVITY_LABELS } },
      orderBy: { createdAt: "desc" },
      take: limit * 3,
    }),
    prisma.recordView.findMany({
      where: { staffId: { in: [...names.keys()] } },
      orderBy: { viewedAt: "desc" },
      take: limit,
      include: { share: { select: { payloadText: true } } },
    }),
  ]);
  const mine = events
    .map((e) => ({ e, d: (e.details ?? {}) as AuditDetails }))
    .filter(({ d }) => d.staffId && names.has(d.staffId));

  // What each line is about, fetched once for all lines.
  const ids = (k: keyof AuditDetails) => [
    ...new Set(mine.map(({ d }) => d[k]).filter((v): v is string => typeof v === "string")),
  ];
  const [groups, payouts, loans, users] = await Promise.all([
    prisma.group.findMany({ where: { id: { in: ids("groupId") } }, select: { id: true, name: true } }),
    prisma.payout.findMany({
      where: { id: { in: ids("payoutId") } },
      select: { id: true, amountFcfa: true, round: { select: { group: { select: { name: true } } } } },
    }),
    prisma.loanRequest.findMany({
      where: { id: { in: ids("loanId") } },
      select: { id: true, amountFcfa: true, grantedFcfa: true, user: { select: { legalName: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: ids("userId") } }, select: { id: true, legalName: true } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const payout = new Map(payouts.map((p) => [p.id, p]));
  const loan = new Map(loans.map((l) => [l.id, l]));
  const userName = new Map(users.map((u) => [u.id, u.legalName]));

  const fromEvents: ConsoleActivity[] = mine.map(({ e, d }) => {
    const action = e.type as ConsoleActivity["action"];
    const p = d.payoutId ? payout.get(d.payoutId) : undefined;
    const l = d.loanId ? loan.get(d.loanId) : undefined;
    const subject =
      p?.round.group.name ??
      l?.user.legalName ??
      (d.userId ? userName.get(d.userId) : undefined) ??
      (d.groupId ? groupName.get(d.groupId) : undefined) ??
      // Team events keep the officer's name in "reason".
      (ACTIVITY[action] === "TEAM" ? d.reason : undefined) ??
      null;
    const detail =
      action === "STAFF_LOAN_DOCUMENT_REVIEWED"
        ? d.accepted
          ? "ACCEPTED"
          : "REDO"
        : action === "STAFF_LOAN_DOCUMENT_VIEWED"
          ? (d.key ?? null)
          : ACTIVITY[action] === "TEAM"
            ? null
            : (d.reason ?? null);
    return {
      at: e.createdAt.toISOString(),
      staffName: names.get(d.staffId as string) ?? "",
      action,
      category: ACTIVITY[action],
      subject,
      round: typeof d.round === "number" ? d.round : null,
      amountFcfa: p?.amountFcfa ?? l?.grantedFcfa ?? l?.amountFcfa ?? null,
      detail,
    };
  });
  const fromViews: ConsoleActivity[] = views.map((view) => ({
    at: view.viewedAt.toISOString(),
    staffName: names.get(view.staffId as string) ?? "",
    action: "STAFF_RECORD_OPENED",
    category: "CREDIT",
    subject: (JSON.parse(view.share.payloadText) as { legalName: string }).legalName,
    round: null,
    amountFcfa: null,
    detail: null,
  }));
  return [...fromEvents, ...fromViews]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
