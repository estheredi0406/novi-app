import type { MySavings } from "@novi/shared";
import { memberRequest } from "./client";

// D123: her savings at the MFI, kept from her pots.
export const getSavings = () => memberRequest<MySavings>("GET", "/v1/me/savings");
export const choosePot = (
  roundId: string,
  body: { keepFcfa: number; pocket: "FREE" | "LOCKED"; lockMonths: 3 | 6 | 12 | null; consent: boolean },
) => memberRequest<MySavings>("PUT", `/v1/me/savings/choices/${roundId}`, body);
export const withdrawSavings = (accountId: string, amountFcfa: number) =>
  memberRequest<MySavings>("POST", `/v1/me/savings/${accountId}/withdraw`, { amountFcfa });
export const takeBackPlacement = (accountId: string, entryId: string) =>
  memberRequest<MySavings>("POST", `/v1/me/savings/${accountId}/placements/${entryId}/withdraw`);
