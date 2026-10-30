import type {
  ChatMessage,
  ChatPage,
  Frequency,
  GroupCall,
  GroupDetail,
  GroupMeetingView,
  GroupSummary,
  Invitation,
  MeetingsPage,
  PayoutOrder,
  VoiceAudio,
} from "@novi/shared";
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

export const listMyGroups = () =>
  memberRequest<GroupSummary[]>("GET", "/v1/groups");
export const listMyInvitations = () =>
  memberRequest<Invitation[]>("GET", "/v1/invitations");
export const getGroup = (id: string) =>
  memberRequest<GroupDetail>("GET", `/v1/groups/${id}`);

export const createGroup = (input: { name: string } & RulesInput) =>
  memberRequest<GroupDetail>("POST", "/v1/groups", input);
export const reviseRules = (id: string, rules: RulesInput) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/rules`, rules);
// D84: shareConsent, her agreement that FUCEC sees her Novi record.
export const proposeGroup = (id: string, shareConsent = false) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/propose`, {
    shareConsent,
  });
export const cancelGroup = (id: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/cancel`, {});

export const invite = (id: string, phone: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/invites`, { phone });
export const cancelInvite = (id: string, inviteId: string) =>
  memberRequest<GroupDetail>(
    "POST",
    `/v1/groups/${id}/invites/${inviteId}/cancel`,
    {},
  );
export const removeSeat = (id: string, memberId: string) =>
  memberRequest<GroupDetail>(
    "POST",
    `/v1/groups/${id}/seats/${memberId}/remove`,
    {},
  );

// Her answer carries the version she read, so a change made meanwhile is caught (D29).
export const acceptRules = (
  id: string,
  version: number,
  shareConsent = false,
) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/accept`, {
    version,
    shareConsent,
  });
export const counterRules = (id: string, version: number, note: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/counter`, {
    version,
    note,
  });
export const declineGroup = (id: string) =>
  memberRequest<void>("POST", `/v1/groups/${id}/decline`, {});

export const setPayoutOrder = (id: string, memberIds: string[]) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/order`, { memberIds });
export const startGroup = (id: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/start`, {});

// The group's chat (D70).
export const listMessages = (
  id: string,
  cursor: { after?: string; before?: string } = {},
) => {
  const query = cursor.after
    ? `?after=${cursor.after}`
    : cursor.before
      ? `?before=${cursor.before}`
      : "";
  return memberRequest<ChatPage>("GET", `/v1/groups/${id}/messages${query}`);
};
export const postMessage = (id: string, body: string) =>
  memberRequest<ChatMessage>("POST", `/v1/groups/${id}/messages`, { body });
// D76: voice notes and calling the group.
export const postVoice = (
  id: string,
  input: { audioBase64: string; durationMs: number; mime: string },
) => memberRequest<ChatMessage>("POST", `/v1/groups/${id}/voice`, input);
export const getVoice = (id: string, messageId: string) =>
  memberRequest<VoiceAudio>(
    "GET",
    `/v1/groups/${id}/messages/${messageId}/voice`,
  );
export const callGroup = (id: string) =>
  memberRequest<GroupCall>("POST", `/v1/groups/${id}/call`, {});
export const hideMessage = (id: string, messageId: string) =>
  memberRequest<ChatMessage>(
    "POST",
    `/v1/groups/${id}/messages/${messageId}/hide`,
    {},
  );

// Group meetings (D71).
export const listMeetings = (id: string) =>
  memberRequest<MeetingsPage>("GET", `/v1/groups/${id}/meetings`);
export const scheduleMeeting = (
  id: string,
  input: {
    title: string;
    agenda: string | null;
    startsAt: string;
    durationMin: number;
  },
) =>
  memberRequest<GroupMeetingView>("POST", `/v1/groups/${id}/meetings`, input);
export const cancelMeeting = (id: string, meetingId: string) =>
  memberRequest<MeetingsPage>(
    "POST",
    `/v1/groups/${id}/meetings/${meetingId}/cancel`,
    {},
  );
export const joinMeeting = (id: string, meetingId: string) =>
  memberRequest<{ url: string }>(
    "POST",
    `/v1/groups/${id}/meetings/${meetingId}/join`,
    {},
  );

// D72: the next cycle with the same members.
// D80: at the end of the cycle, does she go again?
export const answerContinue = (id: string, continues: boolean) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/continue`, {
    continues,
  });
export const startNextCycle = (id: string) =>
  memberRequest<GroupDetail>("POST", `/v1/groups/${id}/next-cycle`, {});
