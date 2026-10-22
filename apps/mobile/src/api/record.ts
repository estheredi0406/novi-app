import type { RecordShareView, SavingsRecord } from "@novi/shared";
import { memberRequest } from "./client";

// Her savings record, the ACEV (Sprint 6), typed with the shapes from @novi/shared.

export const getRecord = () => memberRequest<SavingsRecord>("GET", "/v1/me/record");
export const listShares = () => memberRequest<RecordShareView[]>("GET", "/v1/me/record/shares");
export const shareRecord = () => memberRequest<RecordShareView>("POST", "/v1/me/record/shares", {});
export const revokeShare = (shareId: string) =>
  memberRequest<RecordShareView>("POST", `/v1/me/record/shares/${shareId}/revoke`, {});

// The page a loan officer opens by scanning the QR code: served by the API,
// so it works on any phone without installing Novi.
export const verifyUrl = (shareId: string) => `${process.env.EXPO_PUBLIC_API_URL ?? ""}/verify/${shareId}`;
