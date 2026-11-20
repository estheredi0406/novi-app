// Demo only (D82).

import { prisma } from "../../lib/db.js";
import { AppError } from "../../lib/errors.js";
import { pilotMode } from "../../lib/pilot.js";
import { runPayouts } from "../payoutService.js";

// Pilot only: brings the next unpaid round to today and runs the payout job,
// so a whole cycle can be shown in one session. Written to the journal.
// The round brought to today is due today: members can still pay it, and
// nobody is covered or told she is late until its day is over (D104). The
// next click ends that day (it moves to yesterday). On the last round, with
// no round left to bring forward, the click just ends its day.
export async function advanceDueDateForDemo(
  mfiId: string,
  staffId: string,
  groupId: string,
  now = new Date(),
) {
  if (!pilotMode()) throw new AppError("NOT_FOUND", 404);
  const group = await prisma.group.findFirst({
    where: { id: groupId, mfiId, state: "ACTIVE" },
  });
  if (!group) throw new AppError("NOT_FOUND", 404);
  const next = await prisma.round.findFirst({
    where: {
      groupId,
      dueDate: { gt: now },
      OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
    },
    orderBy: { number: "asc" },
  });
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (!next) {
    // The last round is due today and its pot has not left: end its day, so
    // the advances cover what is missing and the pot can leave.
    const open = await prisma.round.findFirst({
      where: {
        groupId,
        dueDate: { gte: today, lte: now },
        OR: [{ payout: null }, { payout: { status: { not: "PAID" } } }],
      },
      orderBy: { number: "asc" },
    });
    if (!open) throw new AppError("NOT_ALLOWED_NOW", 409);
    await prisma.round.update({ where: { id: open.id }, data: { dueDate: yesterday } });
    await prisma.auditEvent.create({
      data: {
        type: "STAFF_DEMO_DUE",
        details: { staffId, groupId, round: open.number, dayEnded: true },
      },
    });
    await runPayouts(now, groupId);
    return { round: open.number };
  }
  await prisma.round.updateMany({
    where: { groupId, number: { lt: next.number }, dueDate: { gte: today } },
    data: { dueDate: yesterday },
  });
  await prisma.round.update({
    where: { id: next.id },
    data: { dueDate: today },
  });
  await prisma.auditEvent.create({
    data: {
      type: "STAFF_DEMO_DUE",
      details: { staffId, groupId, round: next.number },
    },
  });
  await runPayouts(now, groupId);
  return { round: next.number };
}
