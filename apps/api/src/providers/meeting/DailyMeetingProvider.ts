import type { MeetingProvider } from "./MeetingProvider.js";

// Daily (daily.co) through its REST API. A private room opens 10 minutes
// before the meeting and closes at its end, ejecting anyone still in it, so
// a forgotten call never runs on. Members start with the camera off: voice
// first, which saves data on a weak connection. Nothing is recorded.
const API = "https://api.daily.co/v1";
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export class DailyMeetingProvider implements MeetingProvider {
  constructor(private readonly apiKey: string) {}

  private async call<T>(method: "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      // Daily's answer names the problem; the key itself is never logged.
      throw new Error(`Daily ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createRoom(input: { name: string; opensAt: Date; closesAt: Date; maxParticipants: number }) {
    const room = await this.call<{ name: string; url: string }>("POST", "/rooms", {
      name: input.name,
      privacy: "private",
      properties: {
        nbf: seconds(input.opensAt),
        exp: seconds(input.closesAt),
        max_participants: input.maxParticipants,
        eject_at_room_exp: true,
        start_video_off: true,
      },
    });
    return { name: room.name, url: room.url };
  }

  async deleteRoom(name: string) {
    await this.call("DELETE", `/rooms/${encodeURIComponent(name)}`);
  }

  async joinUrl(input: {
    roomName: string;
    roomUrl: string;
    userId: string;
    userName: string;
    isOwner: boolean;
    closesAt: Date;
    lang: "fr" | "en";
  }) {
    const { token } = await this.call<{ token: string }>("POST", "/meeting-tokens", {
      properties: {
        room_name: input.roomName,
        user_name: input.userName,
        user_id: input.userId,
        is_owner: input.isOwner,
        exp: seconds(input.closesAt),
        eject_at_token_exp: true,
        start_video_off: true,
        lang: input.lang,
      },
    });
    return `${input.roomUrl}?t=${encodeURIComponent(token)}`;
  }
}
