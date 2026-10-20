import { randomInt } from "node:crypto";

// Draws the payout order: who receives the pot first, second, and so on.
// Fisher-Yates with the operating system's secure random numbers, so every
// order is equally likely and nobody, Novi included, can predict or steer it.
// The random source can be replaced in tests.
export function drawOrder<T>(items: readonly T[], random: (max: number) => number = randomInt): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = random(i + 1); // 0 to i, inclusive
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}