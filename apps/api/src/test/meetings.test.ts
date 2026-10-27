import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { meetings } from "../providers/index.js";
import { MockMeetingProvider } from "../providers/meeting/MockMeetingProvider.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// Group meetings (D71).

if (!(meetings instanceof MockMeetingProvider)) throw new Error("Tests require the mock meeting provider.");
const rooms = meetings;

const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) =>
      auth(
        request(app)
          .post(path)
          .send(body ?? {}),
      ),
  };
}
type Client = ReturnType<typeof as>;

// Akossiwa's proposed group, Abla accepted; Koffi accepted too when full.
async function group(full = true) {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const [akossiwa, abla, koffi] = people.map((p) => as(p.tokens.accessToken)) as [Client, Client, Client];
  const groupId = (await akossiwa.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await akossiwa.post(`/v1/groups/${groupId}/propose`);
  await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  if (full) await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  return { groupId, akossiwa, abla, koffi, ids: people.map((p) => p.member.id) };
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const meeting = (startsAt = inMinutes(120), durationMin = 30) => ({
  title: "Point sur le tour 2",
  agenda: "Le retard de paiement, la date du prochain tour",
  startsAt,
  durationMin,
});

// Moves a meeting so that it starts in the given number of minutes.
const moveTo = (id: string, minutes: number) =>
  prisma.groupMeeting.update({ where: { id }, data: { startsAt: new Date(Date.now() + minutes * 60_000) } });

afterEach(() => {
  rooms.failNext = false;
});

describe("scheduling a meeting", () => {
  it("creates a private room the size of the group, open 10 minutes before until the end", async () => {
    const { groupId, akossiwa } = await group();
    const res = await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Point sur le tour 2", state: "UPCOMING", durationMin: 30, joined: [] });

    const saved = await prisma.groupMeeting.findUniqueOrThrow({ where: { id: res.body.id } });
    const room = rooms.rooms.get(saved.roomName as string);
    expect(room?.maxParticipants).toBe(3);
    expect((saved.startsAt.getTime() - (room?.opensAt.getTime() ?? 0)) / 60_000).toBe(10);
    expect(((room?.closesAt.getTime() ?? 0) - saved.startsAt.getTime()) / 60_000).toBe(30);
  });

  it("posts the meeting in the group's chat", async () => {
    const { groupId, akossiwa, abla } = await group();
    const planned = (await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting())).body;
    const lines = (await abla.get(`/v1/groups/${groupId}/messages`)).body.messages;
    expect(lines.at(-1)).toMatchObject({
      kind: "EVENT",
      event: "MEETING_SCHEDULED",
      meeting: { id: planned.id, title: "Point sur le tour 2" },
    });
  });

  it("is for the organiser only", async () => {
    const { groupId, abla } = await group();
    expect((await abla.post(`/v1/groups/${groupId}/meetings`, meeting())).status).toBe(409);
  });

  it("refuses a time in the past, too far ahead, an odd length, or overlapping another meeting", async () => {
    const { groupId, akossiwa } = await group();
    const post = (body: object) => akossiwa.post(`/v1/groups/${groupId}/meetings`, body);
    expect((await post(meeting(inMinutes(-30)))).body.error.code).toBe("MEETING_TIME_INVALID");
    expect((await post(meeting(inMinutes(61 * 24 * 60)))).body.error.code).toBe("MEETING_TIME_INVALID");
    expect((await post(meeting(inMinutes(120), 90))).status).toBe(400);
    expect((await post(meeting(inMinutes(120), 60))).status).toBe(201);
    expect((await post(meeting(inMinutes(150), 30))).body.error.code).toBe("MEETING_TIME_INVALID");
  });

  it("allows at most 5 meetings planned ahead", async () => {
    const { groupId, akossiwa } = await group();
    for (let day = 1; day <= 5; day++) {
      expect((await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting(inMinutes(day * 24 * 60)))).status).toBe(201);
    }
    const sixth = await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting(inMinutes(6 * 24 * 60)));
    expect(sixth.body.error.code).toBe("MEETING_LIMIT");
  });

  it("leaves nothing behind when the video provider does not answer", async () => {
    const { groupId, akossiwa } = await group();
    rooms.failNext = true;
    const res = await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("MEETING_UNAVAILABLE");
    expect(await prisma.groupMeeting.count({ where: { groupId } })).toBe(0);
  });
});

describe("joining a meeting", () => {
  it("gives each member her own pass, only while the room is open", async () => {
    const { groupId, akossiwa, abla, ids } = await group();
    const planned = (await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting())).body;
    const join = (member: Client) => member.post(`/v1/groups/${groupId}/meetings/${planned.id}/join`);

    expect((await join(abla)).body.error.code).toBe("MEETING_NOT_OPEN");
    await moveTo(planned.id, 5); // starts in 5 minutes: the room is open
    const hers = await join(abla);
    expect(hers.status).toBe(200);
    expect(hers.body.url).toContain(`member-${ids[1]}`);
    expect((await join(akossiwa)).body.url).toContain(`owner-${ids[0]}`);

    const list = (await abla.get(`/v1/groups/${groupId}/meetings`)).body;
    expect(list.upcoming[0]).toMatchObject({ state: "OPEN", joined: ["Abla", "Akossiwa"] });
  });

  it("is closed once the meeting has ended, and lists it as past", async () => {
    const { groupId, akossiwa, abla } = await group();
    const planned = (await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting())).body;
    await moveTo(planned.id, -45); // started 45 minutes ago, lasted 30
    expect((await abla.post(`/v1/groups/${groupId}/meetings/${planned.id}/join`)).body.error.code).toBe(
      "MEETING_NOT_OPEN",
    );
    const list = (await abla.get(`/v1/groups/${groupId}/meetings`)).body;
    expect(list.upcoming).toHaveLength(0);
    expect(list.past[0]).toMatchObject({ id: planned.id, state: "ENDED" });
  });

  it("is refused to anyone outside the group", async () => {
    const { groupId, akossiwa } = await group();
    const planned = (await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting())).body;
    await moveTo(planned.id, 5);
    const ama = { niu: "TEST-0005", legalName: "Ama Essi Lawson", dateOfBirth: "1992-11-19" };
    const stranger = as((await signedUpMember("+22890000005", undefined, ama, "Ama")).tokens.accessToken);
    expect((await stranger.post(`/v1/groups/${groupId}/meetings/${planned.id}/join`)).status).toBe(404);
  });

  it("is refused to a member who left the group (D69)", async () => {
    const { groupId, akossiwa, abla, ids } = await group();
    const planned = (await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting())).body;
    await moveTo(planned.id, 5);
    await prisma.membership.updateMany({ where: { groupId, userId: ids[1] }, data: { exitReason: "LEFT" } });
    expect((await abla.post(`/v1/groups/${groupId}/meetings/${planned.id}/join`)).status).toBe(409);
  });
});

describe("cancelling a meeting", () => {
  it("closes the room, tells the group in the chat, and lists it as cancelled", async () => {
    const { groupId, akossiwa, abla } = await group();
    const planned = (await akossiwa.post(`/v1/groups/${groupId}/meetings`, meeting())).body;
    expect((await abla.post(`/v1/groups/${groupId}/meetings/${planned.id}/cancel`)).status).toBe(409);
    const res = await akossiwa.post(`/v1/groups/${groupId}/meetings/${planned.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.past[0]).toMatchObject({ id: planned.id, state: "CANCELLED" });

    const saved = await prisma.groupMeeting.findUniqueOrThrow({ where: { id: planned.id } });
    expect(rooms.deleted).toContain(saved.roomName);
    const lines = (await abla.get(`/v1/groups/${groupId}/messages`)).body.messages;
    expect(lines.at(-1)).toMatchObject({ event: "MEETING_CANCELLED", meeting: { id: planned.id } });
    await moveTo(planned.id, 5);
    expect((await abla.post(`/v1/groups/${groupId}/meetings/${planned.id}/join`)).body.error.code).toBe(
      "MEETING_NOT_OPEN",
    );
  });
});
