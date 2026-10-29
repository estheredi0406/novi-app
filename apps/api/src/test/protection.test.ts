import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { base32Decode, codeForStep, totpStep } from "../lib/totp.js";
import { mfi, payments } from "../providers/index.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { releasePayout, runPayouts } from "../services/payoutService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// Protecting the group (D69): next of kin, death, departure, a lost phone,
// a new organiser, and a debt to the solidarity fund that must be settled.

if (!(mfi instanceof MockMfiAdapter) || !(payments instanceof MockPaymentProvider)) {
  throw new Error("Tests require the mock MFI and payment providers.");
}
const mockPayments = payments;

const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};
const PAST = new Date("2026-01-02T00:00:00Z");
const PHONES = ["+22890000001", "+22890000002", "+22890000003"];

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
    patch: (path: string, body: object) => auth(request(app).patch(path).send(body)),
  };
}
type Client = ReturnType<typeof as>;

// Akossiwa's started group of three, held at FUCEC-Togo.
async function activeGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember(PHONES[1], undefined, ABLA, "Abla"),
    await signedUpMember(PHONES[2], undefined, KOFFI, "Koffi"),
  ];
  const [organiser, abla, koffi] = people.map((p) => as(p.tokens.accessToken)) as [Client, Client, Client];
  const groupId = (await organiser.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: PHONES[1] });
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: PHONES[2] });
  await organiser.post(`/v1/groups/${groupId}/propose`);
  await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await organiser.post(`/v1/groups/${groupId}/start`);
  const ids = people.map((p) => p.member.id);
  return { groupId, members: [organiser, abla, koffi], ids, people };
}

// Who receives the pot in each round, as indexes into members.
async function turnOrder(groupId: string, ids: string[]): Promise<number[]> {
  const rounds = await prisma.round.findMany({ where: { groupId }, orderBy: { number: "asc" } });
  return rounds.map((r) => ids.indexOf(r.beneficiaryId));
}

async function pay(member: Client, groupId: string, round: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "TOGOCEL" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
}

const makeDue = (groupId: string, number: number) =>
  prisma.round.update({ where: { groupId_number: { groupId, number } }, data: { dueDate: PAST } });

async function release(groupId: string, number: number) {
  const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number } } });
  return releasePayout(payout.id, null);
}

// The MFI's fund, as if other groups had already put their 2% in it.
const seedFund = (groupId: string, amountFcfa = 20000) =>
  prisma.ledgerEntry.create({ data: { groupId, type: "RESERVE_IN", amountFcfa, note: "test: other groups" } });

// A round where everyone pays except the members listed, then due and run.
async function roundWithout(groupId: string, members: Client[], number: number, missing: number[]) {
  for (const [i, member] of members.entries()) if (!missing.includes(i)) await pay(member, groupId, number);
  await makeDue(groupId, number);
  await runPayouts();
}

async function officer(mfiCode = "FUCEC", email = "mawuli@fucec.example") {
  await prisma.mfi.upsert({ where: { code: mfiCode }, create: { code: mfiCode, name: `${mfiCode} test` }, update: {} });
  const { password, totpSecret } = await createStaff({ mfiCode, email, name: "Mawuli Adzo" });
  // Past his first login: his own password is set (D81).
  await prisma.staffUser.update({ where: { email }, data: { mustChangePassword: false } });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  const login = await request(app).post("/v1/staff/login").send({ email, password, code });
  return as(login.body.accessToken);
}

const KIN = { name: "Kossi Mensah", phone: "+22891000009", relation: "Fils" };

describe("her next of kin", () => {
  it("is saved in her profile, and can be changed or removed", async () => {
    const me = as((await signedUpMember()).tokens.accessToken);
    const saved = await me.patch("/v1/me", { nextOfKin: KIN });
    expect(saved.status).toBe(200);
    expect(saved.body.nextOfKin).toEqual(KIN);
    expect((await me.get("/v1/me")).body.nextOfKin).toEqual(KIN);
    expect((await me.patch("/v1/me", { nextOfKin: null })).body.nextOfKin).toBeNull();
  });

  it("cannot be her own number, nor a number outside Togo", async () => {
    const me = as((await signedUpMember()).tokens.accessToken);
    expect((await me.patch("/v1/me", { nextOfKin: { ...KIN, phone: PHONES[0] } })).status).toBe(400);
    expect((await me.patch("/v1/me", { nextOfKin: { ...KIN, phone: "+22966000001" } })).status).toBe(400);
  });
});

describe("a debt to the solidarity fund", () => {
  it("stops her joining or creating a group until she has repaid it", async () => {
    const { groupId, members } = await activeGroup();
    await seedFund(groupId);
    await roundWithout(groupId, members, 1, [2]); // Koffi does not pay; the fund covers him

    const koffi = members[2] as Client;
    const refused = await koffi.post("/v1/groups", { ...SMALL_GROUP, name: "Koffi's" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("DEBT_OUTSTANDING");

    await pay(koffi, groupId, 1); // he pays late: the fund is repaid
    expect((await koffi.post("/v1/groups", { ...SMALL_GROUP, name: "Koffi's" })).status).toBe(201);
  });

  it("is taken from her own pot first, when her turn comes", async () => {
    const { groupId, members, ids } = await activeGroup();
    await seedFund(groupId);
    const order = await turnOrder(groupId, ids);
    const second = order[1] as number; // the member paid in round 2
    await roundWithout(groupId, members, 1, [second]); // she misses round 1
    await release(groupId, 1);
    await roundWithout(groupId, members, 2, []);
    await release(groupId, 2);

    const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 2 } } });
    expect(payout).toMatchObject({ amountFcfa: 14700 - 4900, coverRepaidFcfa: 4900, status: "PAID" });
    const cover = await prisma.reserveCover.findFirstOrThrow({ where: { userId: ids[second] } });
    expect(cover.repaidAt).not.toBeNull();
    // Her late payment afterwards does not repay the same cover a second time.
    await pay(members[second] as Client, groupId, 1);
    expect(await prisma.ledgerEntry.count({ where: { groupId, type: "RESERVE_REPAY" } })).toBe(1);
  });
});

describe("the officer at the counter (D69)", () => {
  it("finds a member of this MFI by her number, and logs that he looked", async () => {
    const { ids } = await activeGroup();
    const desk = await officer();
    const found = await desk.get(`/v1/console/members?phone=${encodeURIComponent(PHONES[1] as string)}`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ userId: ids[1], legalName: ABLA.legalName, owedFcfa: 0, closed: false });
    expect(found.body.seats).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { type: "STAFF_MEMBER_LOOKUP" } })).toBe(1);
    expect((await desk.get("/v1/console/members?phone=%2B22899999999")).status).toBe(404);
  });

  it("does not find members of another MFI's groups", async () => {
    await activeGroup();
    const other = await officer("COOPEC", "ama@coopec.example");
    expect((await other.get(`/v1/console/members?phone=${encodeURIComponent(PHONES[1] as string)}`)).status).toBe(404);
  });
});

describe("when a member dies", () => {
  it("needs a number to pay: her next of kin's, or one the officer gives", async () => {
    const { groupId, ids } = await activeGroup();
    const desk = await officer();
    const noKin = await desk.post(`/v1/console/members/${ids[1]}/exit`, { groupId, reason: "DEATH" });
    expect(noKin.status).toBe(409);
    expect(noKin.body.error.code).toBe("NEXT_OF_KIN_MISSING");
  });

  it("sends her pot to her next of kin, and nobody owes her shares", async () => {
    const { groupId, members, ids, people } = await activeGroup();
    await seedFund(groupId, 30000);
    const order = await turnOrder(groupId, ids);
    const last = order[2] as number; // she would be paid in round 3
    await (members[last] as Client).patch("/v1/me", { nextOfKin: KIN });
    await roundWithout(groupId, members, 1, []);
    await release(groupId, 1);

    const desk = await officer();
    const recorded = await desk.post(`/v1/console/members/${ids[last]}/exit`, { groupId, reason: "DEATH" });
    expect(recorded.status).toBe(200);
    expect(recorded.body).toMatchObject({ closed: true });
    expect(recorded.body.seats[0]).toMatchObject({ exitReason: "DEATH", exitPayoutPhone: KIN.phone });

    // Rounds 2 and 3 go on without her; the fund pays her shares.
    await roundWithout(groupId, members, 2, [last]);
    await release(groupId, 2);
    await roundWithout(groupId, members, 3, [last]);
    await release(groupId, 3);

    const covers = await prisma.reserveCover.findMany({ where: { userId: ids[last] } });
    expect(covers).toHaveLength(2);
    expect(covers.every((c) => c.writtenOffAt !== null)).toBe(true);
    const pot = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 3 } } });
    expect(pot).toMatchObject({ phone: KIN.phone, toNextOfKin: true, amountFcfa: 14700, coverRepaidFcfa: 0 });
    // The group completed, and her written-off shares were not charged to the others.
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    expect(group.state).toBe("COMPLETED");
    const returns = await prisma.reserveReturn.findMany({ where: { groupId } });
    expect(returns.find((r) => r.userId === ids[last])?.phone).toBe(KIN.phone);

    // Nobody can log in to her account any more.
    const person = people[last] as (typeof people)[number];
    const login = await request(app)
      .post("/v1/auth/login")
      .send({ phone: PHONES[last], pin: "4829", installationId: person.installationId });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("ACCOUNT_CLOSED");
  });

  it("passes the organiser's role to the next member in the turn order", async () => {
    const { groupId, ids } = await activeGroup();
    await prisma.user.update({ where: { id: ids[0] }, data: { nextOfKinName: KIN.name, nextOfKinPhone: KIN.phone } });
    const order = await turnOrder(groupId, ids);
    const desk = await officer();
    await desk.post(`/v1/console/members/${ids[0]}/exit`, { groupId, reason: "DEATH" });
    const next = order.find((i) => i !== 0) as number;
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    expect(group.organiserId).toBe(ids[next]);
    const seat = await prisma.membership.findFirstOrThrow({ where: { groupId, userId: ids[next] } });
    expect(seat.role).toBe("ORGANISER");
  });
});

describe("when a member leaves a started group", () => {
  it("keeps what the fund pays for her as her debt", async () => {
    const { groupId, members, ids } = await activeGroup();
    await seedFund(groupId);
    const order = await turnOrder(groupId, ids);
    const first = order[0] as number; // paid in round 1, then leaves
    await roundWithout(groupId, members, 1, []);
    await release(groupId, 1);
    const desk = await officer();
    expect(
      (await desk.post(`/v1/console/members/${ids[first]}/exit`, { groupId, reason: "LEFT" })).status,
    ).toBe(200);
    await roundWithout(groupId, members, 2, [first]);

    const cover = await prisma.reserveCover.findFirstOrThrow({ where: { userId: ids[first] } });
    expect(cover.writtenOffAt).toBeNull();
    const found = await desk.get(`/v1/console/members?phone=${encodeURIComponent(PHONES[first] as string)}`);
    expect(found.body.owedFcfa).toBe(4900);
    expect(found.body.seats[0].exitReason).toBe("LEFT");
  });
});

describe("a lost or stolen phone", () => {
  it("moves her account to her new number and logs the old phone out", async () => {
    const { ids, people } = await activeGroup();
    const desk = await officer();
    const abla = people[1] as (typeof people)[number];
    const changed = await desk.post(`/v1/console/members/${ids[1]}/phone`, { phone: "+22891112233" });
    expect(changed.status).toBe(200);
    expect(changed.body.phone).toBe("+22891112233");

    const sessions = await prisma.session.findMany({ where: { userId: ids[1] } });
    expect(sessions.every((s) => s.revokedReason === "PHONE_CHANGED")).toBe(true);
    // Even on her own phone, she needs the code sent to the new number.
    const login = await request(app)
      .post("/v1/auth/login")
      .send({ phone: "+22891112233", pin: "4829", installationId: abla.installationId });
    expect(login.body.error.code).toBe("NEW_DEVICE");
    const old = await request(app)
      .post("/v1/auth/login")
      .send({ phone: PHONES[1], pin: "4829", installationId: abla.installationId });
    expect(old.status).toBe(401);
  });

  it("refuses a number that already has an account", async () => {
    const { ids } = await activeGroup();
    const desk = await officer();
    const res = await desk.post(`/v1/console/members/${ids[1]}/phone`, { phone: PHONES[2] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PHONE_ALREADY_REGISTERED");
  });
});

describe("a new organiser", () => {
  it("is named by the officer from the group's members", async () => {
    const { groupId, ids } = await activeGroup();
    const desk = await officer();
    expect((await desk.post(`/v1/console/groups/${groupId}/organiser`, { userId: ids[2] })).status).toBe(200);
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    expect(group.organiserId).toBe(ids[2]);
    const roles = await prisma.membership.findMany({ where: { groupId }, select: { userId: true, role: true } });
    expect(roles.filter((r) => r.role === "ORGANISER").map((r) => r.userId)).toEqual([ids[2]]);
    const log = await desk.get("/v1/console/activity");
    expect(log.body.map((a: { action: string }) => a.action)).toContain("STAFF_ORGANISER_CHANGED");
  });
});
