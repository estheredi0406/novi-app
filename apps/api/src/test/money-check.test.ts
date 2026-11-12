import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { mfi, payments } from "../providers/index.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { getMoney, resolveMismatch } from "../services/moneyCheckService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(mfi instanceof MockMfiAdapter) || !(payments instanceof MockPaymentProvider)) {
  throw new Error("Tests require the mock MFI and payment providers.");
}
const mockPayments = payments;

// D124: the Comptes page: where the money is, and a wrong amount the officer must see.
const GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };
const PAST = new Date("2026-01-02T00:00:00Z");

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
    put: (path: string, body?: object) => auth(request(app).put(path).send(body ?? {})),
  };
}
type Member = ReturnType<typeof as>;

async function activeGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const members = people.map((p) => as(p.tokens.accessToken));
  const groupId = (await members[0]!.post("/v1/groups", GROUP)).body.id as string;
  await prisma.mfi.updateMany({ data: { autoReleaseFcfa: null } });
  await members[0]!.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await members[0]!.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await members[0]!.post(`/v1/groups/${groupId}/propose`);
  await members[1]!.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await members[2]!.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await members[0]!.post(`/v1/groups/${groupId}/start`);
  const round = await prisma.round.findUniqueOrThrow({
    where: { groupId_number: { groupId, number: 1 } },
    include: { beneficiary: true, group: true },
  });
  const phones = ["+22890000001", "+22890000002", "+22890000003"];
  const receiver = members[phones.indexOf(round.beneficiary.phone)] as Member;
  return { groupId, members, round, receiver };
}

async function pay(member: Member, groupId: string, number: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${number}/pay`, { operator: "TOGOCEL" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
}

async function officer() {
  const mfiRow = await prisma.mfi.findFirstOrThrow({ where: { code: "MAWULI" } });
  await createStaff({ mfiCode: "MAWULI", email: `o${Date.now()}@mawuli.example`, name: "Officer" });
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { mfiId: mfiRow.id } });
  return { mfiId: mfiRow.id, staffId: staff.id };
}


describe("the Comptes page (D124)", () => {
  it("lists today's payments with where the money is, and adds members' savings to what the MFI owes", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0]!, groupId, 1);
    const { mfiId } = await officer();
    const money = await getMoney(mfiId);
    expect(money.today[0]).toMatchObject({ kind: "CONTRIBUTION", round: 1, amountFcfa: 7500, where: "GROUP_ACCOUNT" });
    expect(money.today[0]?.seat).not.toBeNull();
    expect(money.owedFcfa).toBe(money.noviFcfa + money.savingsFcfa);
  });

  it("shows a payment FedaPay confirmed for another amount, credits nothing, and lets the officer mark it handled", async () => {
    const { groupId, members } = await activeGroup();
    const paid = await members[0]!.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" });
    const c = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
    const delivery = mockPayments.settle(c.providerRef as string, "PAID", 4000);
    await request(app)
      .post("/v1/webhooks/payments")
      .set("X-FEDAPAY-SIGNATURE", delivery.signature)
      .set("Content-Type", "application/json")
      .send(delivery.body);
    const { mfiId, staffId } = await officer();
    const money = await getMoney(mfiId);
    expect(money.toCheck).toHaveLength(1);
    expect(money.toCheck[0]).toMatchObject({ expectedFcfa: 7500, receivedFcfa: 4000, paidNow: false });
    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: c.id } })).status).not.toBe("PAID");
    const after = await resolveMismatch(mfiId, staffId, c.id, "Remboursé 4 000 F à la membre");
    expect(after.toCheck).toHaveLength(0);
  });
});
