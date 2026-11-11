// D114: when Novi asks the operator again about a payment not confirmed:
// 15 min, 1 h, 6 h and 24 h after it was asked (or after her report).
const MIN = 60_000;
export const CHECK_AFTER_MS = [15 * MIN, 60 * MIN, 6 * 60 * MIN, 24 * 60 * MIN];

type Checked = { autoChecks: number; requestedAt: Date; reportedAt: Date | null };

export function nextCheckAt(c: Checked): Date | null {
  const wait = CHECK_AFTER_MS[c.autoChecks];
  if (wait === undefined) return null;
  return new Date((c.reportedAt ?? c.requestedAt).getTime() + wait);
}
