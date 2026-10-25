// Her on-time streak in one group: how many rounds in a row, counting back
// from the latest, she paid on or before the due date. Shown on home as
// encouragement; never shown to anyone else (D33).
//
// A round whose day has not come yet and that she has not paid does not break
// the streak: she still has time. A late or missed payment ends it.

export type StreakRound = { dueDay: number; paidDay: number | null }; // days as UTC midnights in ms

export function onTimeStreak(roundsInOrder: readonly StreakRound[], today: number): number {
  let streak = 0;
  for (let i = roundsInOrder.length - 1; i >= 0; i--) {
    const round = roundsInOrder[i];
    if (!round) continue;
    if (round.paidDay === null) {
      if (round.dueDay >= today) continue; // still time to pay
      break; // missed
    }
    if (round.paidDay > round.dueDay) break; // late
    streak += 1;
  }
  return streak;
}
