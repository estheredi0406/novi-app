import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// A small group of 3: Akossiwa and two places.
const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};
const { name: _name, ...SMALL_RULES } = SMALL_GROUP;

const ABLA_PHONE = "+22890000002";

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

// Akossiwa creates her group and invites Abla's number. Unless asked to stay
// a draft, the group is then proposed, so Abla can answer.
async function ablaInvited({ propose = true } = {}) {
  const akossiwa = await signedUpMember();
  const organiser = as(akossiwa.tokens.accessToken);
  const abla = await signedUpMember(ABLA_PHONE, undefined, ABLA, "Abla");
  const member = as(abla.tokens.accessToken);

  const groupId = (await organiser.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: ABLA_PHONE });
  if (propose) await organiser.post(`/v1/groups/${groupId}/propose`);
  return { organiser, member, groupId, ablaId: abla.member.id, akossiwaId: akossiwa.member.id };
}

describe("accepting the rules", () => {
  it("gives her a seat with the version she accepted, and uses up her invitation", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    const res = await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });

    expect(res.status).toBe(200);
    expect(res.body.myRole).toBe("MEMBER");
    expect(res.body.seats).toContainEqual(
      expect.objectContaining({ displayName: "Abla", state: "ACCEPTED", acceptedCurrentRules: true }),
    );
    expect(res.body.pendingInvites).toEqual([]);
    expect((await member.get("/v1/invitations")).body).toEqual([]);
    expect((await organiser.get(`/v1/groups/${groupId}`)).body.seats).toHaveLength(2);
  });

  it("puts the group in her list of groups", async () => {
    const { member, groupId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });

    const res = await member.get("/v1/groups");
    expect(res.body).toEqual([expect.objectContaining({ id: groupId, myRole: "MEMBER", mySeatState: "ACCEPTED" })]);
  });

  it("refuses an answer while the group is still a draft", async () => {
    const { member, groupId } = await ablaInvited({ propose: false });
    const res = await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });

  it("refuses an answer to rules the organiser has changed since she read them", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    await organiser.post(`/v1/groups/${groupId}/rules`, { ...SMALL_RULES, dueDay: 6 });

    const res = await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RULES_CHANGED");
    expect((await member.post(`/v1/groups/${groupId}/accept`, { version: 2 })).status).toBe(200);
  });

  it("refuses the organiser answering her own group", async () => {
    const { organiser, groupId } = await ablaInvited();
    const res = await organiser.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("MEMBERS_ONLY");
  });

  it("tells someone who was not invited that the group does not exist", async () => {
    const { groupId } = await ablaInvited();
    const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
    const res = await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
    expect(res.status).toBe(404);
  });

  it("refuses a 4th group once she has accepted 3 (D26)", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });

    // Three more groups, each inviting Abla. The organiser may propose only 3
    // herself (D26), so the last one is put in PROPOSED directly.
    const others: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = (await organiser.post("/v1/groups", { ...SMALL_GROUP, name: `Groupe ${i + 2}` })).body.id as string;
      await organiser.post(`/v1/groups/${id}/invites`, { phone: ABLA_PHONE });
      others.push(id);
    }
    await organiser.post(`/v1/groups/${others[0]}/propose`);
    await organiser.post(`/v1/groups/${others[1]}/propose`);
    await prisma.group.update({ where: { id: others[2] }, data: { state: "PROPOSED" } });

    expect((await member.post(`/v1/groups/${others[0]}/accept`, { version: 1 })).status).toBe(200);
    expect((await member.post(`/v1/groups/${others[1]}/accept`, { version: 1 })).status).toBe(200);
    const fourth = await member.post(`/v1/groups/${others[2]}/accept`, { version: 1 });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe("GROUP_LIMIT_REACHED");
  });
});

describe("asking for a change", () => {
  it("keeps her place and shows her note to the group", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    const note = "Le samedi m'arrange mieux, le marché est fermé le vendredi.";
    const res = await member.post(`/v1/groups/${groupId}/counter`, { version: 1, note });

    expect(res.status).toBe(200);
    const seats = (await organiser.get(`/v1/groups/${groupId}`)).body.seats;
    expect(seats).toContainEqual(
      expect.objectContaining({ displayName: "Abla", state: "COUNTERED", acceptedCurrentRules: false, counterNote: note }),
    );
  });

  it("refuses an empty note", async () => {
    const { member, groupId } = await ablaInvited();
    const res = await member.post(`/v1/groups/${groupId}/counter`, { version: 1, note: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("asks her again when the organiser changes the rules, and she can accept the new version", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/counter`, { version: 1, note: "Samedi, s'il vous plaît." });
    await organiser.post(`/v1/groups/${groupId}/rules`, { ...SMALL_RULES, dueDay: 6 });

    const waiting = (await organiser.get(`/v1/groups/${groupId}`)).body.seats;
    expect(waiting).toContainEqual(expect.objectContaining({ displayName: "Abla", state: "INVITED", counterNote: null }));

    const res = await member.post(`/v1/groups/${groupId}/accept`, { version: 2 });
    expect(res.body.seats).toContainEqual(
      expect.objectContaining({ displayName: "Abla", state: "ACCEPTED", acceptedCurrentRules: true }),
    );
  });
});

describe("saying no", () => {
  it("frees her place without showing her name to the group", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    const res = await member.post(`/v1/groups/${groupId}/decline`);
    expect(res.status).toBe(204);

    const group = (await organiser.get(`/v1/groups/${groupId}`)).body;
    expect(group.seats.map((s: { displayName: string }) => s.displayName)).toEqual(["Akossiwa"]);
    expect(group.pendingInvites).toEqual([]);
    expect((await member.get("/v1/invitations")).body).toEqual([]);
    expect((await member.get(`/v1/groups/${groupId}`)).status).toBe(404);
  });

  it("can be said while the group is still a draft", async () => {
    const { member, groupId } = await ablaInvited({ propose: false });
    expect((await member.post(`/v1/groups/${groupId}/decline`)).status).toBe(204);
  });

  it("lets her leave a group she had accepted, before it starts", async () => {
    const { member, groupId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });

    expect((await member.post(`/v1/groups/${groupId}/decline`)).status).toBe(204);
    expect((await member.get("/v1/groups")).body).toEqual([]);
  });

  it("lets the organiser invite her again, and she can then accept", async () => {
    const { organiser, member, groupId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/decline`);

    expect((await organiser.post(`/v1/groups/${groupId}/invites`, { phone: ABLA_PHONE })).status).toBe(200);
    expect((await member.post(`/v1/groups/${groupId}/accept`, { version: 1 })).status).toBe(200);
  });

  it("refuses leaving once the group is running", async () => {
    const { member, groupId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await prisma.group.update({ where: { id: groupId }, data: { state: "ACTIVE" } });

    const res = await member.post(`/v1/groups/${groupId}/decline`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });

  it("records each answer in the audit trail", async () => {
    const { member, groupId, ablaId } = await ablaInvited();
    await member.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await member.post(`/v1/groups/${groupId}/decline`);

    const events = await prisma.auditEvent.findMany({
      where: { userId: ablaId, type: { startsWith: "GROUP_" } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual(["GROUP_ACCEPTED", "GROUP_DECLINED"]);
  });
});