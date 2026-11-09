import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { base32Decode, codeForStep, totpStep } from "../lib/totp.js";
import { payments } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { runPayouts } from "../services/payoutService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D105: the MFI works by exception. Small pots leave by themselves, large
// ones need two officers, and the officer checks the payments a member says
// left her account.

if (!(payments instanceof MockPaymentProvider)) throw new Error("Tests require the mock payment provider.");
const mockPayments = payments;

const GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };
const PAST = new Date("2026-01-02T00:00:00Z");

function as(token: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
    put: (path: string, body?: object) => auth(request(app).put(path).send(body ?? {})),
  };
}
type Client = ReturnType<typeof as>;

// Akossiwa's started group of three at FUCEC-Togo: a pot of 15 000 F.
async function activeGroup() {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const organiser = as(akossiwa.tokens.accessToken);
  const groupId = (await organiser.post("/v1/groups", GROUP)).body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await organiser.post(`/v1/groups/${groupId}/propose`);
  await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await organiser.post(`/v1/groups/${groupId}/start`);
  return { groupId, members: [organiser, as(abla.tokens.accessToken), as(koffi.tokens.accessToken)] };
}

// She asks to pay; the operator then confirms, or does not.
async function pay(member: Client, groupId: string, round: number, outcome: "PAID" | "FAILED" = "PAID") {
  const asked = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "TOGOCEL" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: asked.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, outcome);
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
  return contribution.id;
}

const makeDue = (groupId: string, number: number) =>
  prisma.round.update({ where: { groupId_number: { groupId, number } }, data: { dueDate: PAST } });

async function officer(email: string, name: string, role: "OFFICER" | "ADMIN" = "OFFICER") {
  await prisma.mfi.upsert({ where: { code: "FUCEC" }, create: { code: "FUCEC", name: "FUCEC-Togo" }, update: {} });
  const { password, totpSecret } = await createStaff({ mfiCode: "FUCEC", email, name, role });
  await prisma.staffUser.update({ where: { email }, data: { mustChangePassword: false } });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  const login = await request(app).post("/v1/staff/login").send({ email, password, code });
  return as(login.body.accessToken);
}

const payoutOf = (groupId: string, number = 1) =>
  prisma.payout.findFirstOrThrow({ where: { round: { groupId, number } } });

describe("pots that leave by themselves (D105)", () => {
  it("sends a full pot up to the MFI's limit on its due date, with no officer, and logs it", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    await runPayouts(); // asks the MFI how the transfer went

    const payout = await payoutOf(groupId);
    expect(payout).toMatchObject({ status: "PAID", amountFcfa: 15000, releasedById: null });
    expect(payout.releasedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { type: "PAYOUT_AUTO_RELEASED" } })).toBe(1);
    // Nothing waits for the officers.
    expect(await prisma.staffAlert.count({ where: { kind: "POT_READY", refId: payout.id } })).toBe(0);
  });

  it("still holds a pot that is not full: the limit never sends a pot short (D48)", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await prisma.reserveCover.deleteMany({});
    await prisma.mfi.updateMany({ data: { autoReleaseFcfa: 1_000_000 } });
    await runPayouts();
    expect((await payoutOf(groupId)).status).toBe("HELD");
  });
});

describe("large pots need two officers (D105)", () => {
  it("asks a second, different officer before a pot above the limit leaves", async () => {
    const { groupId, members } = await activeGroup();
    await prisma.mfi.updateMany({ data: { autoReleaseFcfa: 10000 } }); // the pot is 15 000
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    expect((await payoutOf(groupId)).status).toBe("READY");

    const mawuli = await officer("mawuli@fucec.example", "Mawuli Adzo");
    const adjo = await officer("adjo@fucec.example", "Adjo Kpodar");
    const [item] = (await mawuli.get("/v1/console/attention")).body;
    expect(item).toMatchObject({ status: "READY", needsTwo: true, canRelease: true, firstApprovedBy: null });

    // Mawuli gives the first approval: the pot does not leave yet.
    const first = await mawuli.post(`/v1/console/payouts/${item.payoutId}/release`);
    expect(first.body[0]).toMatchObject({ status: "READY", firstApprovedBy: "Mawuli Adzo", canRelease: false });
    expect((await payoutOf(groupId)).status).toBe("READY");

    // He cannot give the second one himself.
    const again = await mawuli.post(`/v1/console/payouts/${item.payoutId}/release`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("SECOND_OFFICER_NEEDED");

    // Adjo sees who approved it, and releases it.
    const [seen] = (await adjo.get("/v1/console/attention")).body;
    expect(seen).toMatchObject({ firstApprovedBy: "Mawuli Adzo", canRelease: true });
    await adjo.post(`/v1/console/payouts/${item.payoutId}/release`);
    const payout = await payoutOf(groupId);
    expect(payout.status).not.toBe("READY");
    expect(payout.firstApprovedById).not.toBe(payout.releasedById);
  });

  it("lets a waiting pot leave by itself once the admin raises the limit above it", async () => {
    const { groupId, members } = await activeGroup();
    await prisma.mfi.updateMany({ data: { autoReleaseFcfa: 10000 } });
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const admin = await officer("adjo@fucec.example", "Adjo Kpodar", "ADMIN");
    const set = await admin.put("/v1/console/auto-release", { amountFcfa: 20000 });
    expect(set.body).toEqual({ autoReleaseFcfa: 20000 });
    await runPayouts();
    expect((await payoutOf(groupId)).status).not.toBe("READY");
  });

  it("lets only an administrator change the limit, or turn it off", async () => {
    await activeGroup();
    const mawuli = await officer("mawuli@fucec.example", "Mawuli Adzo");
    expect((await mawuli.put("/v1/console/auto-release", { amountFcfa: 1_000_000 })).body.error.code).toBe("ADMIN_ONLY");
    const admin = await officer("adjo@fucec.example", "Adjo Kpodar", "ADMIN");
    expect((await admin.put("/v1/console/auto-release", { amountFcfa: null })).body).toEqual({ autoReleaseFcfa: null });
    expect((await admin.get("/v1/console/overview")).body.autoReleaseFcfa).toBeNull();
  });
});

describe("payments a member says left her account (D105, D110)", () => {
  async function reported() {
    const g = await activeGroup();
    const abla = g.members[1] as Client;
    const contributionId = await pay(abla, g.groupId, 1, "FAILED");
    expect((await abla.post(`/v1/contributions/${contributionId}/report`)).status).toBe(200);
    return { ...g, abla, contributionId };
  }

  it("lists it for the officer, with what he needs to find it on the statement", async () => {
    const { groupId, contributionId } = await reported();
    const mawuli = await officer("mawuli@fucec.example", "Mawuli Adzo");
    expect((await mawuli.get("/v1/console/reported")).body).toEqual([
      expect.objectContaining({
        contributionId,
        groupId,
        roundNumber: 1,
        memberName: "Abla",
        phone: "+22890000002",
        operator: "TOGOCEL",
        amountFcfa: 7500,
      }),
    ]);
    expect((await mawuli.get("/v1/console/overview")).body.reported).toBe(1);
  });

  it("keeps her from paying a second time while the MFI checks", async () => {
    const { abla, groupId } = await reported();
    const again = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("PAYMENT_REPORTED");
  });

  it("credits it when the officer finds it on the operator's statement", async () => {
    const { contributionId } = await reported();
    const mawuli = await officer("mawuli@fucec.example", "Mawuli Adzo");
    const res = await mawuli.post(`/v1/console/reported/${contributionId}`, { arrived: true });
    expect(res.body).toEqual([]);
    const row = await prisma.contribution.findUniqueOrThrow({ where: { id: contributionId } });
    expect(row.status).toBe("PAID");
    expect(row.reportCheckedById).not.toBeNull();
    expect(await prisma.ledgerEntry.count({ where: { contributionId } })).toBe(1);
  });

  it("tells her to pay again when it is not found, and lets her", async () => {
    const { abla, groupId, contributionId } = await reported();
    const mawuli = await officer("mawuli@fucec.example", "Mawuli Adzo");
    await mawuli.post(`/v1/console/reported/${contributionId}`, { arrived: false });

    const round = (await abla.get(`/v1/groups/${groupId}/rounds/1`)).body;
    expect(round).toMatchObject({ myReported: false, myReportRejected: true });
    // The same attempt cannot be reported again; a new payment works.
    expect((await abla.post(`/v1/contributions/${contributionId}/report`)).status).toBe(409);
    await pay(abla, groupId, 1);
    const after = (await abla.get(`/v1/groups/${groupId}/rounds/1`)).body;
    expect(after).toMatchObject({ myStatus: "PAID", myReportRejected: false });
  });
});
