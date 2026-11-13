import type { GroupHelp, LoanBusiness, LoanPage, LoanPurpose } from "@novi/shared";
import { memberRequest } from "./client";

// D87: help inside the group.
export const getHelp = (groupId: string) =>
  memberRequest<GroupHelp>("GET", `/v1/groups/${groupId}/help`);
export const askSwap = (groupId: string, partnerId: string) =>
  memberRequest<GroupHelp>("POST", `/v1/groups/${groupId}/swaps`, {
    partnerId,
  });
export const answerSwap = (groupId: string, swapId: string, yes: boolean) =>
  memberRequest<GroupHelp>(
    "POST",
    `/v1/groups/${groupId}/swaps/${swapId}/answer`,
    { yes },
  );
export const decideSwap = (groupId: string, swapId: string, yes: boolean) =>
  memberRequest<GroupHelp>(
    "POST",
    `/v1/groups/${groupId}/swaps/${swapId}/decide`,
    { yes },
  );
export const cancelSwap = (groupId: string, swapId: string) =>
  memberRequest<GroupHelp>(
    "POST",
    `/v1/groups/${groupId}/swaps/${swapId}/cancel`,
    {},
  );
// Microloan requests to the MFI (D89).
export const getLoans = () => memberRequest<LoanPage>("GET", "/v1/me/loans");
export const requestLoan = (amountFcfa: number, purpose: LoanPurpose, business: LoanBusiness) =>
  memberRequest<LoanPage>("POST", "/v1/me/loans", { amountFcfa, purpose, business });
export const withdrawLoan = (loanId: string) =>
  memberRequest<LoanPage>("POST", `/v1/me/loans/${loanId}/withdraw`, {});
