import type { RuleBreak, RuleResult } from "./groupRules.js";
import { AppError } from "./errors.js";

// How each refusal from the rules engine is answered: 400 the request itself
// is wrong, 403 this person may not do it, 409 the group (or the round) is
// not in a state that allows it. Shared by every service that applies the
// rules, so the same refusal always gets the same answer.
const STATUS: Record<RuleBreak, number> = {
  NOT_ALLOWED_NOW: 409,
  ORGANISER_ONLY: 403,
  MEMBERS_ONLY: 403,
  SIZE_OUT_OF_RANGE: 400,
  AMOUNT_OUT_OF_RANGE: 400,
  DUE_DAY_OUT_OF_RANGE: 400,
  GROUP_FULL: 409,
  GROUP_LIMIT_REACHED: 409,
  START_LIMIT_REACHED: 409,
  SEATS_NOT_FILLED: 409,
  NOT_EVERYONE_ACCEPTED: 409,
  RULES_CHANGED: 409,
  ORDER_INVALID: 400,
  ROUND_NOT_OPEN: 409,
  ALREADY_PAID: 409,
  PAYMENT_IN_PROGRESS: 409,
};

// Turns a refusal from the rules engine into the API error with the same code.
export function enforce(result: RuleResult): void {
  if (!result.ok) throw new AppError(result.reason, STATUS[result.reason]);
}
