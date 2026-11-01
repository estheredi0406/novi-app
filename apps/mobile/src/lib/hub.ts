import type { GroupSummary } from "@novi/shared";

// The choices behind home and the Payer button (D92), kept apart from the
// screens so they can be tested on their own.

// She still owes this round: not paid yet, or her last attempt failed.
export function owes(group: GroupSummary): boolean {
  const status = group.currentRound?.myStatus;
  return status === "UNPAID" || status === "FAILED";
}

// Home's cards: running groups only, the ones where she owes first, in the
// order they came otherwise (the sort is stable).
export function cardsInOrder(groups: readonly GroupSummary[]): GroupSummary[] {
  return groups.filter((g) => g.currentRound).sort((a, b) => Number(owes(b)) - Number(owes(a)));
}

// What the Payer button does: open the one round she owes, ask which group
// when she owes in several, or say there is nothing to pay.
export type PayTarget = { kind: "one"; group: GroupSummary } | { kind: "pick"; groups: GroupSummary[] } | { kind: "none" };

export function payTarget(groups: readonly GroupSummary[]): PayTarget {
  const owing = groups.filter(owes);
  const [only] = owing;
  if (owing.length === 1 && only) return { kind: "one", group: only };
  if (owing.length > 1) return { kind: "pick", groups: owing };
  return { kind: "none" };
}
