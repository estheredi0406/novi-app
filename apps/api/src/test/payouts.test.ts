import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { mfi, payments, sms } from "../providers/index.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { runPayouts } from "../services/payoutService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(mfi instanceof MockMfiAdapter) || !(payments instanceof MockPaymentProvider) || !(sms instanceof MockSmsProvider)) {
  throw new Error("Tests require the mock MFI, payment and SMS providers.");
}
const mockMfi = mfi;
const mockPayments = payments;
const outbox = sms.sent;

// Akossiwa's group of 3: 5 000 FCFA every Friday, so each pot is 15 000 FCFA.
const SMALL_GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };
const PAST = new Date("2026-01-02T00:00:00Z");

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

type Member = ReturnType<typeof as>;

// A started group of three: Akossiwa, Abla and Koffi.
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

  const members = [organiser, as(abla.tokens.accessToken), as(koffi.tokens.accessToken)];
  return { groupId, members, akossiwa: organiser };
}

// She pays a round and the provider confirms it.
async function pay(member: Member, groupId: string, round: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "TOGOCEL" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
}

// Moves a round's Friday into the past.
const makeDue = (groupId: string, number: number) =>
  prisma.round.update({ where: { groupId_number: { groupId, number } }, data: { dueDate: PAST } });

async function roundOne(groupId: string) {
  return prisma.round.findUniqueOrThrow({
    where: { groupId_number: { groupId, number: 1 } },
    include: { payout: true, beneficiary: { select: { phone: true, displayName: true } } },
  });
}

describe("sending a round's pot", () => {
  it("waits for the due date, even when everyone has paid", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await runPayouts();

    expect((await roundOne(groupId)).payout).toBeNull();
  });

  it("sends the full pot on the due date to the member whose turn it is, on her own number", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    const round = await roundOne(groupId);
    expect(round.payout).toMatchObject({ status: "PAID", amountFcfa: 15000, phone: round.beneficiary.phone, operator: "TOGOCEL" });
    expect(mockMfi.payouts.get(round.payout?.id as string)).toMatchObject({ amountFcfa: 15000, phone: round.beneficiary.phone });
  });

  it("writes a PAYOUT line to the ledger and tells her by SMS", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    const round = await roundOne(groupId);
    const line = await prisma.ledgerEntry.findFirstOrThrow({ where: { groupId, type: "PAYOUT" } });
    expect(line).toMatchObject({ amountFcfa: 15000, userId: round.beneficiaryId });
    const message = outbox.at(-1);
    expect(message?.to).toBe(round.beneficiary.phone);
    expect(message?.text).toContain("15 000 FCFA");
  });

  it("sends a pot once only, even when two runs happen at the same moment (D49)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    const before = mockMfi.payouts.size;
    await Promise.all([runPayouts(), runPayouts(), runPayouts()]);

    expect(mockMfi.payouts.size - before).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { groupId, type: "PAYOUT" } })).toBe(1);
  });
});

describe("holding a pot that is not full (D48)", () => {
  it("holds the pot instead of sending it short, and everyone sees it held", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members.at(0) as Member, groupId, 1);
    await pay(members.at(1) as Member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    expect((await roundOne(groupId)).payout?.status).toBe("HELD");
    const seen = (await (members.at(2) as Member).get(`/v1/groups/${groupId}/rounds`)).body;
    expect(seen[0]).toMatchObject({ payoutStatus: "HELD", paidCount: 2 });
  });

  it("releases the pot as soon as the last payment arrives", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members.at(0) as Member, groupId, 1);
    await pay(members.at(1) as Member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    await pay(members.at(2) as Member, groupId, 1); // no job run needed
    expect((await roundOne(groupId)).payout).toMatchObject({ status: "PAID", amountFcfa: 15000 });
  });
});

describe("when the MFI is slow or refuses", () => {
  it("waits for the MFI's confirmation when it accepts the transfer for later", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    mockMfi.nextPayout = "SENT";
    await runPayouts();

    const sent = (await roundOne(groupId)).payout;
    expect(sent?.status).toBe("SENT");
    expect(await prisma.ledgerEntry.count({ where: { groupId, type: "PAYOUT" } })).toBe(0);

    mockMfi.settlePayout(sent?.id as string, "PAID");
    await runPayouts();
    expect((await roundOne(groupId)).payout?.status).toBe("PAID");
  });

  it("tries a refused transfer again on the next run", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    mockMfi.nextPayout = "FAILED";
    await runPayouts();
    expect((await roundOne(groupId)).payout?.status).toBe("FAILED");

    await runPayouts();
    expect((await roundOne(groupId)).payout?.status).toBe("PAID");
    expect(await prisma.ledgerEntry.count({ where: { groupId, type: "PAYOUT" } })).toBe(1);
  });
});

describe("the end of the cycle", () => {
  it("completes the group once every round has been paid out (D27)", async () => {
    const { groupId, members, akossiwa } = await activeGroup();
    for (const number of [1, 2, 3]) {
      for (const member of members) await pay(member, groupId, number);
      await makeDue(groupId, number);
      await runPayouts();
    }

    const group = (await akossiwa.get(`/v1/groups/${groupId}`)).body;
    expect(group.state).toBe("COMPLETED");
    const ledger = (await akossiwa.get(`/v1/groups/${groupId}/ledger`)).body;
    expect(ledger.filter((line: { type: string }) => line.type === "PAYOUT")).toHaveLength(3);
  });
});
