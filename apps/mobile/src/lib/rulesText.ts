import type { Frequency, GroupRules, GroupState, SeatState } from "@novi/shared";
import type { TFunction } from "i18next";
import { formatFcfa } from "./format";

// "every Friday" or "on the 15th of each month", in her language.
export function scheduleText(t: TFunction, frequency: Frequency, dueDay: number): string {
  return frequency === "WEEKLY"
    ? t("rules.everyWeekday", { day: t(`days.${dueDay}`) })
    : t("rules.everyMonthDay", { day: dueDay });
}

// One line for lists: "5 000 FCFA every Friday · 10 members".
export function rulesSummary(t: TFunction, rules: Pick<GroupRules, "amountFcfa" | "frequency" | "dueDay" | "size">) {
  return `${formatFcfa(rules.amountFcfa)} ${scheduleText(t, rules.frequency, rules.dueDay)} · ${t("rules.members", {
    count: rules.size,
  })}`;
}

// Where a group is, in words: "Members deciding", "Running".
export function stateLabel(t: TFunction, state: GroupState): string {
  return t(`groupState.${state}`);
}

// Where a seat is, in words: "Accepted", "Asked for a change".
export function seatLabel(t: TFunction, state: SeatState): string {
  return t(`seatState.${state}`);
}
