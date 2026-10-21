import type { Frequency, GroupDetail, GroupSummary, Invitation, PayoutOrder } from "@novi/shared";
import { memberRequest } from "./client";

// The group endpoints, typed with the shapes from @novi/shared. There is no
// way to search or list other people's groups: a group is reached only by
// invitation (D40).

export type RulesInput = {
  amountFcfa: number;
  frequency: Frequency;
  dueDay: number;
  size: number;
  payoutOrder: PayoutOrder;
};

export const listMyGroups = () => memberRequest<GroupSummary[]>("GET", "/v1/groups");
export const listMyInvitations = () => memberRequest<Invitation[]>("GET", "/v1/invitations");
export const getGroup = (id: string) => memberRequest<GroupDetail>("GET", `/v1/groups/${id}`);

export const createGroup = (input: { name: string } & RulesInput) =>
  memberRequest<GroupDetail>("POST", "/v1/groups", input);
export const reviseRules = (id: string, rules: RulesInput) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/rules`, rules);
export const proposeGroup = (id: string) => memberRequest<GroupDetail>("POST", `/v1/groups/${id}/propose`, {});
export const cancelGroup = (id: string) => memberRequest<GroupDetail>("POST", `/v1/groups/${id}/cancel`, {});

export const invite = (id: string, phone: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/invites`, { phone });
export const cancelInvite = (id: string, inviteId: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/invites/${inviteId}/cancel`, {});
export const removeSeat = (id: string, memberId: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/seats/${memberId}/remove`, {});

// Her answer carries the version she read, so a change made meanwhile is caught (D29).
export const acceptRules = (id: string, version: number) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/accept`, { version });
export const counterRules = (id: string, version: number, note: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/counter`, { version, note });
export const declineGroup = (id: string) => memberRequest<void>("POST", `/v1/groups/${id}/decline`, {});

export const setPayoutOrder = (id: string, memberIds: string[]) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/order`, { memberIds });
export const startGroup = (id: string) => memberRequest<GroupDetail>("POST", `/v1/groups/${id}/start`, {});
