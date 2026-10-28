import { Prisma } from "../generated/prisma/client.js";
import type { ReminderKind } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";
import { isoDay } from "../lib/schedule.js";
import { reminderSms } from "../lib/smsText.js";
import { sms } from "../providers/index.js";
import { notifyDue } from "./notifyService.js";

// Reminders before a contribution is due (F16): an SMS the day before, and
// one on the morning of the due day, to each member who has not paid yet.
// Sent only in the daytime in Lomé (GMT all year), never twice.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_HOUR = 8; // 08:00 in Lomé
const LAST_HOUR = 19; // nothing after 19:00

export async function runReminders(now = new Date()): Promise<number> {
  const hour = now.getUTCHours();
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return 0;

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const rounds = await prisma.round.findMany({
    where: { dueDate: { in: [today, tomorrow] }, group: { state: "ACTIVE" } },
    include: {
      contributions: { where: { status: { in: ["PAID", "PENDING"] } }, select: { userId: true } },
      group: {
        include: {
          rulesVersions: true,
          memberships: { where: { payoutPosition: { not: null } }, include: { user: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const round of rounds) {
    const dueToday = round.dueDate.getTime() === today.getTime();
    const kind: ReminderKind = dueToday ? "DUE_DAY" : "DAY_BEFORE";
    const rules = round.group.rulesVersions.find((r) => r.version === round.group.currentVersion);
    const paying = new Set(round.contributions.map((c) => c.userId));

    for (const seat of round.group.memberships) {
      if (paying.has(seat.userId)) continue;
      // The row is written first: if it already exists, this reminder went out.
      try {
        await prisma.reminder.create({ data: { roundId: round.id, userId: seat.userId, kind } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
      await sms.send(
        seat.user.phone,
        reminderSms(seat.user.language, {
          groupName: round.group.name,
          amountFcfa: rules?.amountFcfa ?? 0,
          date: isoDay(round.dueDate),
          dueToday,
        }),
      );
      await notifyDue(seat.userId, round.groupId, round.group.name, rules?.amountFcfa ?? 0, dueToday);
      sent += 1;
    }
  }
  return sent;
}

// Checks every 15 minutes while the API is up.
export function startReminderJob(everyMs = 15 * 60 * 1000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runReminders()
      .catch((err: unknown) => console.error("Reminder job failed:", err))
      .finally(() => {
        running = false;
      });
  }, everyMs);
}
