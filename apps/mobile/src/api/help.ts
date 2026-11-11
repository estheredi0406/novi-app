import type { GroupHelp, LoanPage, LoanPurpose } from "@novi/shared";
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
// D89: microloan requests to the MFI.
export const getLoans = () => memberRequest<LoanPage>("GET", "/v1/me/loans");
export const requestLoan = (
  amountFcfa: number,
  purpose: LoanPurpose,
  months: number,
) =>
  memberRequest<LoanPage>("POST", "/v1/me/loans", {
    amountFcfa,
    purpose,
    months,
  });
export const withdrawLoan = (loanId: string) =>
  memberRequest<LoanPage>("POST", `/v1/me/loans/${loanId}/withdraw`, {});

// D91: her documents, once preselected.
export const consentToDocuments = (loanId: string) =>
  memberRequest<LoanPage>(
    "POST",
    `/v1/me/loans/${loanId}/documents-consent`,
    {},
  );
export const sendDocument = (
  loanId: string,
  key: string,
  photo: { mime: string; base64: string },
) =>
  memberRequest<LoanPage>(
    "PUT",
    `/v1/me/loans/${loanId}/documents/${key}`,
    photo,
  );
