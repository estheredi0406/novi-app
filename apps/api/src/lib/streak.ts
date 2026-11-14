// Her on-time streak in one group, counted back from the latest round. A round
// not due yet does not break it; a late or missed payment does. Only she sees it
// (D33).

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
