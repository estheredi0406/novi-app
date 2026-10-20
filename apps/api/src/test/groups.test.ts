import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { ABLA, signedUpMember } from "./helpers.js";

// Akossiwa's group: 5 000 FCFA every Friday, 10 members.
const FRIDAY_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 10,
  payoutOrder: "DRAWN",
};

const { name: _name, ...FRIDAY_RULES } = FRIDAY_GROUP;

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

async function organiser() {
  const { tokens, member } = await signedUpMember();
  return { api: as(tokens.accessToken), member };
}

async function createdGroup(api: ReturnType<typeof as>, body: object = FRIDAY_GROUP) {
  const res = await api.post("/v1/groups", body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("creating a group", () => {
  it("creates a draft with version 1 of the rules and the organiser in the first seat", async () => {
    const { api, member } = await organiser();
    const res = await api.post("/v1/groups", FRIDAY_GROUP);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Pagnes Assigamé",
      state: "DRAFT",
      mfiName: "FUCEC-Togo",
      myRole: "ORGANISER",
      rules: { version: 1, amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 10, payoutOrder: "DRAWN" },
    });
    expect(res.body.seats).toEqual([
      {
        memberId: member.id,
        displayName: "Akossiwa",
        role: "ORGANISER",
        state: "ACCEPTED",
        acceptedCurrentRules: true,
        counterNote: null,
      },
    ]);
  });

  it("refuses a group of 2 with the rules engine's own error code", async () => {
    const { api } = await organiser();
    const res = await api.post("/v1/groups", { ...FRIDAY_GROUP, size: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SIZE_OUT_OF_RANGE");
  });

  it("refuses an amount that is not whole FCFA", async () => {
    const { api } = await organiser();
    const res = await api.post("/v1/groups", { ...FRIDAY_GROUP, amountFcfa: 2500.5 });
    expect(res.body.error.code).toBe("AMOUNT_OUT_OF_RANGE");
  });

  it("refuses fields it does not know, such as a state chosen by the phone", async () => {
    const { api } = await organiser();
    const res = await api.post("/v1/groups", { ...FRIDAY_GROUP, state: "ACTIVE" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses anyone who is not logged in", async () => {
    const res = await request(app).post("/v1/groups").send(FRIDAY_GROUP);
    expect(res.status).toBe(401);
  });
});

describe("seeing groups", () => {
  it("lists the groups where she holds a seat", async () => {
    const { api } = await organiser();
    await createdGroup(api);
    const res = await api.get("/v1/groups");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: "Pagnes Assigamé", seatsHeld: 1, myRole: "ORGANISER" });
  });

  it("answers NOT_FOUND to someone with no seat in the group, as if it did not exist", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");

    const res = await as(abla.tokens.accessToken).get(`/v1/groups/${groupId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("changing the rules", () => {
  it("creates version 2 and keeps version 1 as the record of what was proposed", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);

    const res = await api.post(`/v1/groups/${groupId}/rules`, { ...FRIDAY_RULES, amountFcfa: 3000 });
    expect(res.status).toBe(200);
    expect(res.body.rules).toMatchObject({ version: 2, amountFcfa: 3000 });

    const versions = await prisma.rulesVersion.findMany({ where: { groupId }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.amountFcfa)).toEqual([5000, 3000]);
  });

  it("puts a member's acceptance back to 'not yet' when the rules change", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);
    await api.post(`/v1/groups/${groupId}/propose`);

    // Until invitations exist (S2.5), Abla's seat is placed directly.
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    await prisma.membership.create({
      data: { groupId, userId: abla.member.id, state: "ACCEPTED", acceptedVersion: 1 },
    });

    const res = await api.post(`/v1/groups/${groupId}/rules`, { ...FRIDAY_RULES, amountFcfa: 3000 });
    const ablaSeat = res.body.seats.find((s: { displayName: string }) => s.displayName === "Abla");
    const organiserSeat = res.body.seats.find((s: { role: string }) => s.role === "ORGANISER");

    expect(ablaSeat).toMatchObject({ state: "INVITED", acceptedCurrentRules: false });
    expect(organiserSeat).toMatchObject({ state: "ACCEPTED", acceptedCurrentRules: true });
  });

  it("refuses a change from a member who is not the organiser", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);
    await api.post(`/v1/groups/${groupId}/propose`);
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    await prisma.membership.create({ data: { groupId, userId: abla.member.id } });

    const res = await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/rules`, FRIDAY_RULES);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORGANISER_ONLY");
  });
});

describe("proposing and cancelling", () => {
  it("moves a draft to PROPOSED", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);
    const res = await api.post(`/v1/groups/${groupId}/propose`);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("PROPOSED");
  });

  it("refuses to propose the same group twice", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);
    await api.post(`/v1/groups/${groupId}/propose`);
    const res = await api.post(`/v1/groups/${groupId}/propose`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });

  it("refuses a 4th live group for the same organiser", async () => {
    const { api } = await organiser();
    for (let i = 0; i < 3; i++) {
      const id = await createdGroup(api);
      expect((await api.post(`/v1/groups/${id}/propose`)).status).toBe(200);
    }
    const fourth = await createdGroup(api);
    const res = await api.post(`/v1/groups/${fourth}/propose`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GROUP_LIMIT_REACHED");
  });

  it("frees a place under the limit when a proposed group is cancelled", async () => {
    const { api } = await organiser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await createdGroup(api);
      await api.post(`/v1/groups/${id}/propose`);
      ids.push(id);
    }
    expect((await api.post(`/v1/groups/${ids[0]}/cancel`)).body.state).toBe("CANCELLED");

    const fourth = await createdGroup(api);
    expect((await api.post(`/v1/groups/${fourth}/propose`)).status).toBe(200);
  });

  it("refuses any change to a cancelled group", async () => {
    const { api } = await organiser();
    const groupId = await createdGroup(api);
    await api.post(`/v1/groups/${groupId}/cancel`);
    const res = await api.post(`/v1/groups/${groupId}/rules`, FRIDAY_RULES);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });

  it("records each step in the audit log", async () => {
    const { api, member } = await organiser();
    const groupId = await createdGroup(api);
    await api.post(`/v1/groups/${groupId}/propose`);
    const events = await prisma.auditEvent.findMany({
      where: { userId: member.id, type: { startsWith: "GROUP_" } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual(["GROUP_CREATED", "GROUP_PROPOSED"]);
  });
});