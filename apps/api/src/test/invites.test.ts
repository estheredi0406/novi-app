import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { ABLA, signedUpMember } from "./helpers.js";

if (!(sms instanceof MockSmsProvider)) throw new Error("Tests require the mock SMS provider.");
const outbox = sms.sent;

// A small group of 3, so "full" is reached quickly: Akossiwa and two places.
const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};

// Numbers with no Novi account.
const AMA = "+22891111111";
const EFUA = "+22891111112";
const DELALI = "+22891111113";

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

// Akossiwa signs up and creates her group.
async function organiserWithGroup() {
  const { tokens, member } = await signedUpMember();
  const api = as(tokens.accessToken);
  const res = await api.post("/v1/groups", SMALL_GROUP);
  return { api, member, groupId: res.body.id as string };
}

describe("inviting by phone number", () => {
  it("invites a number and shows it to the group masked", async () => {
    const { api, groupId } = await organiserWithGroup();
    const res = await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });

    expect(res.status).toBe(200);
    expect(res.body.pendingInvites).toEqual([{ id: expect.any(String), maskedPhone: "+228 91 •• •• 11" }]);
  });

  it("sends an SMS naming the organiser, the group and the amount", async () => {
    const { api, groupId } = await organiserWithGroup();
    await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });

    const message = outbox.at(-1);
    expect(message?.to).toBe(AMA);
    expect(message?.text).toContain("Akossiwa");
    expect(message?.text).toContain("Pagnes Assigamé");
    expect(message?.text).toContain("5 000 FCFA");
  });

  it("answers the organiser the same way whether or not the number uses Novi", async () => {
    const { api, groupId } = await organiserWithGroup();
    await signedUpMember("+22890000002", undefined, ABLA, "Abla");

    const toMember = await api.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
    const toStranger = await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });

    // Neither invitation creates a seat or reveals a name: both are masked numbers.
    expect(toStranger.body.seats).toHaveLength(1);
    expect(toStranger.body.pendingInvites.map((i: { maskedPhone: string }) => i.maskedPhone)).toEqual([
      "+228 90 •• •• 02",
      "+228 91 •• •• 11",
    ]);
    expect(toMember.status).toBe(toStranger.status);
  });

  it("refuses an invitation once every place is taken, counting invitations not answered yet", async () => {
    const { api, groupId } = await organiserWithGroup();
    await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });
    await api.post(`/v1/groups/${groupId}/invites`, { phone: EFUA });

    const res = await api.post(`/v1/groups/${groupId}/invites`, { phone: DELALI });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GROUP_FULL");
  });

  it("refuses the same number twice, and the organiser's own number", async () => {
    const { api, groupId } = await organiserWithGroup();
    await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });

    expect((await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA })).body.error.code).toBe("ALREADY_INVITED");
    expect((await api.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000001" })).body.error.code).toBe(
      "ALREADY_INVITED",
    );
  });

  it("refuses a number that is not Togolese", async () => {
    const { api, groupId } = await organiserWithGroup();
    const res = await api.post(`/v1/groups/${groupId}/invites`, { phone: "+2250700000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses invitations from someone who is not the organiser", async () => {
    const { groupId } = await organiserWithGroup();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    // Until answering exists (S2.6), Abla's seat is placed directly.
    await prisma.membership.create({ data: { groupId, userId: abla.member.id, state: "ACCEPTED", acceptedVersion: 1 } });

    const res = await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/invites`, { phone: AMA });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANISER_ONLY");
  });

  it("refuses invitations once the group is running", async () => {
    const { api, groupId } = await organiserWithGroup();
    await prisma.group.update({ where: { id: groupId }, data: { state: "ACTIVE" } });

    const res = await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });
});

describe("withdrawing invitations and removing seats", () => {
  it("frees a place when an invitation is withdrawn", async () => {
    const { api, groupId } = await organiserWithGroup();
    const first = await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });
    await api.post(`/v1/groups/${groupId}/invites`, { phone: EFUA });

    const inviteId = first.body.pendingInvites[0].id as string;
    const cancelled = await api.post(`/v1/groups/${groupId}/invites/${inviteId}/cancel`);
    expect(cancelled.body.pendingInvites).toHaveLength(1);

    expect((await api.post(`/v1/groups/${groupId}/invites`, { phone: DELALI })).status).toBe(200);
  });

  it("can invite a number again after its invitation was withdrawn", async () => {
    const { api, groupId } = await organiserWithGroup();
    const first = await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA });
    await api.post(`/v1/groups/${groupId}/invites/${first.body.pendingInvites[0].id}/cancel`);

    expect((await api.post(`/v1/groups/${groupId}/invites`, { phone: AMA })).status).toBe(200);
  });

  it("removes a member's seat, freeing her place", async () => {
    const { api, groupId } = await organiserWithGroup();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    await prisma.membership.create({ data: { groupId, userId: abla.member.id, state: "ACCEPTED", acceptedVersion: 1 } });

    const res = await api.post(`/v1/groups/${groupId}/seats/${abla.member.id}/remove`);
    expect(res.status).toBe(200);
    expect(res.body.seats.map((s: { displayName: string }) => s.displayName)).toEqual(["Akossiwa"]);
  });

  it("refuses to remove the organiser's own seat", async () => {
    const { api, member, groupId } = await organiserWithGroup();
    const res = await api.post(`/v1/groups/${groupId}/seats/${member.id}/remove`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CANNOT_REMOVE_ORGANISER");
  });
});

describe("her invitations", () => {
  it("shows an invitation to the invited member, with the rules she would accept", async () => {
    const { api, groupId } = await organiserWithGroup();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    await api.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });

    const res = await as(abla.tokens.accessToken).get("/v1/invitations");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        groupId,
        groupName: "Pagnes Assigamé",
        organiserName: "Akossiwa",
        mfiName: "FUCEC-Togo",
        seatsHeld: 1,
        rules: expect.objectContaining({ amountFcfa: 5000, size: 3 }),
      }),
    ]);
  });

  it("shows the invitation to a number that signs up after being invited", async () => {
    const { api, groupId } = await organiserWithGroup();
    await api.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });

    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    const res = await as(abla.tokens.accessToken).get("/v1/invitations");
    expect(res.body.map((i: { groupId: string }) => i.groupId)).toEqual([groupId]);
  });

  it("no longer shows a withdrawn invitation", async () => {
    const { api, groupId } = await organiserWithGroup();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    const invited = await api.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
    await api.post(`/v1/groups/${groupId}/invites/${invited.body.pendingInvites[0].id}/cancel`);

    expect((await as(abla.tokens.accessToken).get("/v1/invitations")).body).toEqual([]);
  });

  it("does not let an invited person open the group before she answers", async () => {
    const { api, groupId } = await organiserWithGroup();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    await api.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });

    expect((await as(abla.tokens.accessToken).get(`/v1/groups/${groupId}`)).status).toBe(404);
  });
});