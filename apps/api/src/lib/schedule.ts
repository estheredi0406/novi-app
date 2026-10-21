import type { Frequency } from "../generated/prisma/enums.js";

// The calendar of a group's rounds, as plain functions so they can be tested
// on their own. Dates are calendar days in UTC: Togo uses GMT all year, with
// no summer time, so a UTC date is the date in Lomé.

const DAY_MS = 24 * 60 * 60 * 1000;

// Drops the time of day: 24 Oct 2026 at 15:40 becomes 24 Oct 2026.
function startOfDay(moment: Date): Date {
  return new Date(Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate()));
}

// Round 1 is due on the first due day AFTER the group starts, never on the
// same day (D44). A group started on a Friday that pays on Fridays is due
// the next Friday, so nobody is asked to pay within hours of the start.
// WEEKLY dueDay: 1 Monday to 7 Sunday. MONTHLY dueDay: 1 to 28.
export function firstDueDate(startedAt: Date, frequency: Frequency, dueDay: number): Date {
  const start = startOfDay(startedAt);

  if (frequency === "WEEKLY") {
    // JavaScript counts Sunday as 0; Novi counts it as 7.
    const target = dueDay % 7;
    const daysAhead = (target - start.getUTCDay() + 7) % 7 || 7;
    return new Date(start.getTime() + daysAhead * DAY_MS);
  }

  const thisMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), dueDay));
  return thisMonth > start ? thisMonth : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, dueDay));
}

// The due date of every round: one week or one month apart. Monthly days
// stop at 28 (D30), so every month has the day and no date slips.
export function dueDates(startedAt: Date, frequency: Frequency, dueDay: number, rounds: number): Date[] {
  const first = firstDueDate(startedAt, frequency, dueDay);
  return Array.from({ length: rounds }, (_, i) =>
    frequency === "WEEKLY"
      ? new Date(first.getTime() + i * 7 * DAY_MS)
      : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, dueDay)),
  );
}

// The round that is open for payment today: the first one not yet past its
// due date. Earlier rounds can still be paid (late); later ones cannot yet.
// After the last due date, the last round stays the current one.
export function currentRoundNumber(dueDatesInOrder: readonly Date[], today: Date): number {
  const day = startOfDay(today);
  const index = dueDatesInOrder.findIndex((due) => due >= day);
  return index === -1 ? dueDatesInOrder.length : index + 1;
}

// "2026-10-30", the form dates travel in between the API and the app.
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
