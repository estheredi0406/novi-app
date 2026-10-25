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

if (!(mfi instanceof MockMfiAdapter) || !(payments instanceof MockPaymentProvider)) {
  throw new Error("Tests require the mock MFI and payment providers.");
}
const mockMfi = mfi;
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

// Akossiwa's started group of three, held at FUCEC-Togo.
async function activeGroup() {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const organiser = as(akossiwa.tokens.accessToken);
  const groupId = (await organiser.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await organiser.post(`/v1/groups/${groupId}/propose`);
  await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await organiser.post(`/v1/groups/${groupId}/start`);
  return { groupId, members: [organiser, as(abla.tokens.accessToken), as(koffi.tokens.accessToken)] };
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

// A logged-in officer of the given MFI.
async function officer(mfiCode = "FUCEC", email = "mawuli@fucec.example") {
  await prisma.mfi.upsert({ where: { code: mfiCode }, create: { code: mfiCode, name: `${mfiCode} test` }, update: {} });
  const { password, totpSecret } = await createStaff({ mfiCode, email, name: "Mawuli Adzo" });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  const login = await request(app).post("/v1/staff/login").send({ email, password, code });
  return as(login.body.accessToken);
}

describe("the console's view of groups", () => {
  it("shows the officer's groups with totals and the balance the account should hold", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const ready = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 1 } } });
    await releasePayout(ready.id, null); // the officer's release (D63)
    await pay(members[0] as Client, groupId, 2);

    const groups = (await (await officer()).get("/v1/console/groups")).body;
    expect(groups).toEqual([
      expect.objectContaining({
        id: groupId,
        state: "ACTIVE",
        amountFcfa: 5000,
        size: 3,
        collectedFcfa: 20000, // 3 x 5 000 for round 1, then 5 000 for round 2
        paidOutFcfa: 15000, // round 1's pot
        balanceFcfa: 5000,
      }),
    ]);
  });

  it("shows each round's totals and payout, never who paid", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[1] as Client, groupId, 1);

    const res = await (await officer()).get(`/v1/console/groups/${groupId}`);
    expect(res.status).toBe(200);
    expect(res.body.roundList[0]).toMatchObject({
      number: 1,
      expectedFcfa: 15000,
      collectedFcfa: 5000,
      paymentsReceived: 1,
      paymentsExpected: 3,
    });
    const text = JSON.stringify(res.body);
    for (const name of ["Akossiwa", "Abla", "Koffi", "+2289000000"]) expect(text).not.toContain(name);
  });

  it("hides another MFI's groups, as if they did not exist", async () => {
    const { groupId } = await activeGroup();
    const other = await officer("WAGES", "officer@wages.example");

    expect((await other.get("/v1/console/groups")).body).toEqual([]);
    expect((await other.get(`/v1/console/groups/${groupId}`)).status).toBe(404);
  });

  it("refuses members", async () => {
    const member = await signedUpMember();
    const res = await as(member.tokens.accessToken).get("/v1/console/groups");
    expect(res.status).toBe(401);
  });
});

describe("payouts that need a look (D53)", () => {
  it("lists a held pot with how many payments are missing, but not who", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await pay(members[1] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    const items = (await (await officer()).get("/v1/console/attention")).body;
    expect(items).toEqual([
      expect.objectContaining({
        groupId,
        roundNumber: 1,
        status: "HELD",
        amountFcfa: 10000,
        paymentsMissing: 1,
        canRetry: false,
        canRelease: false,
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain("Koffi");
  });

  it("gives the officer no way to send a held pot short", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [held] = (await desk.get("/v1/console/attention")).body;

    const res = await desk.post(`/v1/console/payouts/${held.payoutId}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });

  it("lets the officer retry a failed transfer, which then reaches the member", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    mockMfi.nextPayout = "FAILED";
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);
    const [failed] = (await desk.get("/v1/console/attention")).body;
    expect(failed).toMatchObject({ status: "FAILED", canRetry: true });

    const res = await desk.post(`/v1/console/payouts/${failed.payoutId}/retry`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const round = await members[0]?.get(`/v1/groups/${groupId}/rounds/1`);
    expect(round?.body.payoutStatus).toBe("PAID");
    expect(await prisma.auditEvent.count({ where: { type: "STAFF_PAYOUT_RETRY" } })).toBe(1);
  });

  it("lists a full, due pot as ready, and sends it only when the officer releases it (D63)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    expect(ready).toMatchObject({ groupId, status: "READY", canRelease: true, receiverTurn: 1, amountFcfa: 15000 });
    expect(JSON.stringify(ready)).not.toMatch(/Akossiwa|Abla|Koffi/);

    const res = await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const round = await members[0]?.get(`/v1/groups/${groupId}/rounds/1`);
    expect(round?.body.payoutStatus).toBe("PAID");
    expect(await prisma.auditEvent.count({ where: { type: "STAFF_PAYOUT_RELEASED" } })).toBe(1);
    expect((await desk.post(`/v1/console/payouts/${ready.payoutId}/release`)).status).toBe(409);
  });

  it("shows the officer a pot its member says she did not receive (D63)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: ready.payoutId } });
    const receiver = (await Promise.all(members.map(async (m) => ({ m, me: (await m.get("/v1/me")).body.id })))).find(
      (x) => x.me === payout.beneficiaryId,
    );
    await receiver?.m.post(`/v1/me/payouts/${payout.id}/receipt`, { received: false });

    const [disputed] = (await desk.get("/v1/console/attention")).body;
    expect(disputed).toMatchObject({ payoutId: payout.id, status: "DISPUTED", canRelease: false, canRetry: false });
  });

  it("sums it all up on the overview", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    const overview = (await (await officer()).get("/v1/console/overview")).body;
    expect(overview).toEqual({
      mfiName: "FUCEC-Togo",
      activeGroups: 1,
      completedGroups: 0,
      balanceFcfa: 5000,
      held: 1,
      failed: 0,
      ready: 0,
      disputed: 0,
    });
  });
});
