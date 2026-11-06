import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { base32Decode, codeForStep, totpStep } from "../lib/totp.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D95: a group chooses the MFI that keeps its money, as part of its rules.
// D98: an officer sees members' records only while he validates the group.

const RULES = {
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
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

const demoMfi = () =>
  prisma.mfi.create({ data: { code: "DEMO", name: "MFI de démonstration" } });

async function officer(mfiCode: string, email: string) {
  const { password, totpSecret } = await createStaff({ mfiCode, email, name: "Mawuli Adzo" });
  await prisma.staffUser.update({ where: { email }, data: { mustChangePassword: false } });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  const login = await request(app).post("/v1/staff/login").send({ email, password, code });
  return as(login.body.accessToken);
}

// Akossiwa's group of three, proposed, with Abla and Koffi invited.
async function proposedGroup(rules: object) {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const organiser = as(akossiwa.tokens.accessToken);
  const created = await organiser.post("/v1/groups", rules);
  const groupId = created.body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await organiser.post(`/v1/groups/${groupId}/propose`, { shareConsent: true });
  return { groupId, created, organiser, abla: as(abla.tokens.accessToken), koffi: as(koffi.tokens.accessToken) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("choosing where the group's money is kept (D95)", () => {
  it("lists the partner MFIs, the default partner first", async () => {
    await demoMfi();
    const akossiwa = await signedUpMember();
    const res = await as(akossiwa.tokens.accessToken).get("/v1/mfis");
    expect(res.status).toBe(200);
    expect(res.body.map((m: { code: string }) => m.code)).toEqual(["FUCEC", "DEMO"]);
  });

  it("keeps the money at the MFI the group chose, and every member sees it in the rules", async () => {
    const demo = await demoMfi();
    const { groupId, created, abla } = await proposedGroup({ ...RULES, mfiId: demo.id });
    expect(created.body).toMatchObject({ mfiName: "MFI de démonstration", rules: { mfiId: demo.id } });
    const invitations = await abla.get("/v1/invitations");
    expect(invitations.body[0]).toMatchObject({ groupId, mfiName: "MFI de démonstration" });
  });

  it("uses the default partner when an older app sends no MFI", async () => {
    const akossiwa = await signedUpMember();
    const res = await as(akossiwa.tokens.accessToken).post("/v1/groups", RULES);
    expect(res.status).toBe(201);
    expect(res.body.mfiName).toBe("FUCEC-Togo");
  });

  it("refuses an MFI that is not a partner", async () => {
    const akossiwa = await signedUpMember();
    const res = await as(akossiwa.tokens.accessToken).post("/v1/groups", {
      ...RULES,
      mfiId: "8f14e45f-ceea-4c6d-9a5b-1c9b2f6e0a11",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MFI_UNKNOWN");
  });

  it("asks every member again when the MFI changes, and forgets agreements given to the old one", async () => {
    const demo = await demoMfi();
    const { groupId, organiser, abla } = await proposedGroup(RULES);
    await abla.post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: true });

    const { name: _name, ...rules } = RULES;
    const changed = await organiser.post(`/v1/groups/${groupId}/rules`, { ...rules, mfiId: demo.id });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ mfiName: "MFI de démonstration", rules: { version: 2, mfiId: demo.id } });
    const ablaSeat = changed.body.seats.find((s: { displayName: string }) => s.displayName === "Abla");
    expect(ablaSeat.acceptedCurrentRules).toBe(false);
    const consents = await prisma.membership.count({ where: { groupId, shareConsentAt: { not: null } } });
    expect(consents).toBe(0);
  });

  it("shows a group only to the officers of the MFI it chose", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    const demo = await demoMfi();
    const { groupId, organiser, abla, koffi } = await proposedGroup({ ...RULES, mfiId: demo.id });
    await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await organiser.post(`/v1/groups/${groupId}/start`);

    const demoDesk = await officer("DEMO", "afi@demo.example");
    await prisma.mfi.upsert({ where: { code: "FUCEC" }, create: { code: "FUCEC", name: "FUCEC-Togo" }, update: {} });
    const fucecDesk = await officer("FUCEC", "mawuli@fucec.example");
    expect((await demoDesk.get(`/v1/console/groups/${groupId}`)).status).toBe(200);
    expect((await fucecDesk.get(`/v1/console/groups/${groupId}`)).status).toBe(404);
  });
});

describe("members' records only while the officer validates (D98)", () => {
  it("lets a member join without sharing her record", async () => {
    const { groupId, abla } = await proposedGroup(RULES);
    const res = await abla.post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: false });
    expect(res.status).toBe(200);
  });

  it("shows records during validation, and no longer once the group is validated", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    const { groupId, organiser, abla, koffi } = await proposedGroup(RULES);
    await abla.post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: true });
    await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await organiser.post(`/v1/groups/${groupId}/start`);

    const desk = await officer("FUCEC", "mawuli@fucec.example");
    const during = (await desk.get(`/v1/console/groups/${groupId}`)).body;
    expect(during.state).toBe("STARTING");
    expect(during.members.filter((m: { consent: boolean }) => m.consent)).toHaveLength(2);

    expect((await desk.post(`/v1/console/groups/${groupId}/approve`)).status).toBe(200);
    const after = (await desk.get(`/v1/console/groups/${groupId}`)).body;
    expect(after.state).toBe("ACTIVE");
    expect(after.members).toEqual([]);
  });
});
