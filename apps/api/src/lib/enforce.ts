import type { RuleBreak, RuleResult } from "./groupRules.js";
import { AppError } from "./errors.js";

// How each refusal from the rules is answered: 400 bad request, 403 not
// allowed for this person, 409 the group is not in the right state.
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
