import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { payments } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { releasePayout, runPayouts } from "../services/payoutService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// The next cycle with the same members (D72).

if (!(payments instanceof MockPaymentProvider)) throw new Error("Tests require the mock payment provider.");
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

// Akossiwa's group of three, run to the end of its cycle.
async function completedGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const members = people.map((p) => as(p.tokens.accessToken)) as [Client, Client, Client];
  const [akossiwa, abla, koffi] = members;
  const groupId = (await akossiwa.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await akossiwa.post(`/v1/groups/${groupId}/propose`);
  await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await akossiwa.post(`/v1/groups/${groupId}/start`);
  for (const number of [1, 2, 3]) {
    for (const member of members) await pay(member, groupId, number);
    await prisma.round.update({ where: { groupId_number: { groupId, number } }, data: { dueDate: PAST } });
    await runPayouts();
    const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number } } });
    await releasePayout(payout.id, null);
  }
  return { groupId, akossiwa, abla, koffi, ids: people.map((p) => p.member.id) };
}

describe("the next cycle", () => {
  it("creates a draft with the same name and rules, linked to the cycle before, and invites the members", async () => {
    const { groupId, akossiwa, abla } = await completedGroup();
    expect((await prisma.group.findUniqueOrThrow({ where: { id: groupId } })).state).toBe("COMPLETED");

    const res = await akossiwa.post(`/v1/groups/${groupId}/next-cycle`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Pagnes Assigamé",
      state: "DRAFT",
      cycleNumber: 2,
      previousCycleId: groupId,
      rules: { amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3 },
    });
    expect(res.body.pendingInvites).toHaveLength(2);
    expect((await akossiwa.get(`/v1/groups/${groupId}`)).body.nextCycleId).toBe(res.body.id);

    // Once proposed, each member accepts the new cycle herself.
    await akossiwa.post(`/v1/groups/${res.body.id}/propose`);
    expect((await abla.post(`/v1/groups/${res.body.id}/accept`, { version: 1 })).status).toBe(200);
  });

  it("can be started only once, only by the organiser, only after the cycle ended", async () => {
    const { groupId, akossiwa, abla } = await completedGroup();
    expect((await abla.post(`/v1/groups/${groupId}/next-cycle`)).status).toBe(403);
    expect((await akossiwa.post(`/v1/groups/${groupId}/next-cycle`)).status).toBe(201);
    expect((await akossiwa.post(`/v1/groups/${groupId}/next-cycle`)).status).toBe(409);

    const running = (await akossiwa.post("/v1/groups", { ...SMALL_GROUP, name: "Autre" })).body.id as string;
    expect((await akossiwa.post(`/v1/groups/${running}/next-cycle`)).status).toBe(409);
  });

  it("does not invite a member who left or died during the cycle (D69)", async () => {
    const { groupId, akossiwa, ids } = await completedGroup();
    await prisma.membership.updateMany({ where: { groupId, userId: ids[2] }, data: { exitReason: "LEFT" } });
    const next = (await akossiwa.post(`/v1/groups/${groupId}/next-cycle`)).body;
    expect(next.pendingInvites).toHaveLength(1);
    expect(next.pendingInvites[0].maskedPhone).toBe("+228 90 •• •• 02");
  });
});
