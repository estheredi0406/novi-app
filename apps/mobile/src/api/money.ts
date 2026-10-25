import type { ContributionView, LedgerLine, MobileOperator, RoundDetail, RoundSummary } from "@novi/shared";
import { memberRequest } from "./client";

// The money endpoints (Sprint 3), typed with the shapes from @novi/shared.

export const listRounds = (groupId: string) => memberRequest<RoundSummary[]>("GET", `/v1/groups/${groupId}/rounds`);
export const getRound = (groupId: string, number: number) =>
  memberRequest<RoundDetail>("GET", `/v1/groups/${groupId}/rounds/${number}`);
export const listLedger = (groupId: string) => memberRequest<LedgerLine[]>("GET", `/v1/groups/${groupId}/ledger`);

// Sends the payment request to her phone; she confirms it there.
export const payRound = (groupId: string, number: number, operator: MobileOperator) =>
  memberRequest<ContributionView>("POST", `/v1/groups/${groupId}/rounds/${number}/pay`, { operator });

// Asks the provider directly whether the money has moved.
export const checkContribution = (contributionId: string) =>
  memberRequest<ContributionView>("POST", `/v1/contributions/${contributionId}/check`, {});

// D63: her answer once the pot reached her.
export const answerReceipt = (payoutId: string, received: boolean) =>
  memberRequest<void>("POST", `/v1/me/payouts/${payoutId}/receipt`, { received });
