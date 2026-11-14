import { signPass } from "../../lib/callPass.js";
import { closeRoom } from "../../services/callSignal.js";
import type { MeetingProvider } from "./MeetingProvider.js";

// D112: calls on Novi's own server, the default now (Daily stays available).
// The room size and hours travel in each member's signed pass.
export class NoviMeetingProvider implements MeetingProvider {
  constructor(private readonly baseUrl: string) {}

  // Kept between createRoom and joinUrl, which the interface calls separately;
  // only the size and the hours, never who is in the room.
  private readonly rooms = new Map<string, { opensAt: Date; closesAt: Date; max: number }>();

  async createRoom(input: { name: string; opensAt: Date; closesAt: Date; maxParticipants: number }) {
    this.rooms.set(input.name, { opensAt: input.opensAt, closesAt: input.closesAt, max: input.maxParticipants });
    return { name: input.name, url: `${this.baseUrl}/call/${encodeURIComponent(input.name)}` };
  }

  async deleteRoom(name: string) {
    this.rooms.delete(name);
    closeRoom(name, "cancelled");
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
    const known = this.rooms.get(input.roomName);
    const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
    const pass = signPass({
      room: input.roomName,
      uid: input.userId,
      name: input.userName,
      owner: input.isOwner,
      // After a restart the room's size is forgotten: a group is at most 15.
      max: known?.max ?? 15,
      // The meeting's own rules decide when she may join (D71); the pass
      // opens now and closes with the room.
      nbf: seconds(new Date()) - 60,
      exp: seconds(input.closesAt),
      lang: input.lang,
    });
    return `${this.baseUrl}/call/${encodeURIComponent(input.roomName)}?t=${encodeURIComponent(pass)}`;
  }
}
