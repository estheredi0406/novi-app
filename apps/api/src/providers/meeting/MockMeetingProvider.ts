import type { MeetingProvider } from "./MeetingProvider.js";

// Used in tests and when no DAILY_API_KEY is set: remembers the rooms it
// was asked for, and returns addresses that lead nowhere.
export class MockMeetingProvider implements MeetingProvider {
  readonly rooms = new Map<string, { opensAt: Date; closesAt: Date; maxParticipants: number }>();
  readonly deleted: string[] = [];
  failNext = false;

  async createRoom(input: { name: string; opensAt: Date; closesAt: Date; maxParticipants: number }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("mock: the meeting provider is unavailable");
    }
    this.rooms.set(input.name, { opensAt: input.opensAt, closesAt: input.closesAt, maxParticipants: input.maxParticipants });
    return { name: input.name, url: `https://novi-mock.daily.co/${input.name}` };
  }

  async deleteRoom(name: string) {
    this.rooms.delete(name);
    this.deleted.push(name);
  }

  async joinUrl(input: { roomUrl: string; userId: string; isOwner: boolean }) {
    return `${input.roomUrl}?t=mock-${input.isOwner ? "owner" : "member"}-${input.userId}`;
  }
}
