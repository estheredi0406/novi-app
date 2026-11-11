import { prisma } from "../lib/db.js";
import { escalateReport, recheckPayment } from "./moneyService.js";

// D114: exceptions handled before anyone looks. A payment the operator has
// not confirmed is usually only late: a webhook lost in a network cut, an
// operator slow at the end of the month. So Novi asks the operator again by
// itself, on a schedule, and an officer sees only what is still unexplained.
// (Transfers refused are retried by the payout job itself: payoutService.)

const MIN = 60_000;
// After the payment was asked (or, once she reported it, after her report).
export const CHECK_AFTER_MS = [15 * MIN, 60 * MIN, 6 * 60 * MIN, 24 * 60 * MIN];
// A reported payment reaches the officers once this many checks found
// nothing: the 1 h check. The later checks still run, and clear it by
// themselves if the operator confirms it after all.
export const ESCALATE_AFTER_CHECKS = 2;

type Checked = { autoChecks: number; requestedAt: Date; reportedAt: Date | null };

export function nextCheckAt(c: Checked): Date | null {
  const wait = CHECK_AFTER_MS[c.autoChecks];
  if (wait === undefined) return null;
  return new Date((c.reportedAt ?? c.requestedAt).getTime() + wait);
}

export async function runPaymentChecks(now = new Date()): Promise<{ checked: number; found: number; escalated: number }> {
  const rows = await prisma.contribution.findMany({
    where: {
      status: { not: "PAID" },
      autoChecks: { lt: CHECK_AFTER_MS.length },
      requestedAt: { gt: new Date(now.getTime() - 30 * 24 * 60 * MIN) },
      OR: [{ status: "PENDING", providerRef: { not: null } }, { reportedAt: { not: null } }],
    },
    orderBy: { requestedAt: "asc" },
    take: 500,
  });
  let checked = 0;
  let found = 0;
  let escalated = 0;
  for (const c of rows) {
    const due = nextCheckAt(c);
    if (!due || due > now) continue;
    // Claimed first: two runs at the same moment check it once.
    const claimed = await prisma.contribution.updateMany({
      where: { id: c.id, autoChecks: c.autoChecks },
      data: { autoChecks: { increment: 1 }, lastCheckedAt: now },
    });
    if (claimed.count === 0) continue;
    checked += 1;
    try {
      if (await recheckPayment(c.id)) {
        found += 1;
        continue;
      }
    } catch (err) {
      console.warn(`Payment ${c.id} not checked again:`, err instanceof Error ? err.message.slice(0, 200) : err);
    }
    if (c.reportedAt && c.autoChecks + 1 >= ESCALATE_AFTER_CHECKS && (await escalateReport(c.id))) escalated += 1;
  }
  if (checked > 0) {
    await prisma.auditEvent.create({ data: { type: "PAYMENTS_AUTO_CHECKED", details: { checked, found, escalated } } });
  }
  return { checked, found, escalated };
}

// Every 5 minutes while the API is up; the previous run must finish first.
export function startPaymentCheckJob(everyMs = 5 * MIN): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runPaymentChecks()
      .catch((err: unknown) => console.error("Payment check job failed:", err))
      .finally(() => {
        running = false;
      });
  }, everyMs);
}
