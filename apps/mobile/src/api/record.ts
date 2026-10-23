import type { Lender, RecordShareView, SavingsRecord } from "@novi/shared";
import { memberRequest } from "./client";

// Her savings record, the ACEV (Sprint 6), typed with the shapes from @novi/shared.

export const getRecord = () => memberRequest<SavingsRecord>("GET", "/v1/me/record");
export const listShares = () => memberRequest<RecordShareView[]>("GET", "/v1/me/record/shares");
export const listLenders = () => memberRequest<Lender[]>("GET", "/v1/me/record/lenders");
// With an MFI's code, only that MFI's staff can open it (D54); without, it is
// a code any lender she hands it to can open (D50).
export const shareRecord = (mfiCode?: string) =>
  memberRequest<RecordShareView>("POST", "/v1/me/record/shares", mfiCode ? { mfiCode } : {});
export const revokeShare = (shareId: string) =>
  memberRequest<RecordShareView>("POST", `/v1/me/record/shares/${shareId}/revoke`, {});

// The page a loan officer opens by scanning the QR code: served by the API,
// so it works on any phone without installing Novi.
export const verifyUrl = (shareId: string) => `${process.env.EXPO_PUBLIC_API_URL ?? ""}/verify/${shareId}`;
