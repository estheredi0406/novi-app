import { randomInt } from "node:crypto";

// Draws the order of turns with the system's secure random numbers (Fisher-Yates),
// so nobody, not even Novi, can predict or steer it.
export function drawOrder<T>(items: readonly T[], random: (max: number) => number = randomInt): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = random(i + 1); // 0 to i, inclusive
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}