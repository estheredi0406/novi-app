import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { firstDueDate, isoDay } from "../lib/schedule.js";
import { payments, sms } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(payments instanceof MockPaymentProvider) || !(sms instanceof MockSmsProvider)) {
  throw new Error("Tests require the mock payment and SMS providers.");
}
const mockPayments = payments;
const outbox = sms.sent;

// Akossiwa's group of 3: 5 000 FCFA every Friday, so each pot is 15 000 FCFA.
const SMALL_GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

// A started group: Akossiwa, Abla and Koffi have accepted, and the MFI has
// opened the account.
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
  const started = await organiser.post(`/v1/groups/${groupId}/start`);
  if (started.body.state !== "ACTIVE") throw new Error("group did not start");

  return {
    groupId,
    akossiwa: organiser,
    abla: as(abla.tokens.accessToken),
    koffi: as(koffi.tokens.accessToken),
    ids: { akossiwa: akossiwa.member.id, abla: abla.member.id, koffi: koffi.member.id },
  };
}

// The webhook the provider would send once she has confirmed on her phone.
function webhook(body: string, signature: string) {
  return request(app).post("/v1/webhooks/payments").set("X-FEDAPAY-SIGNATURE", signature).set("Content-Type", "application/json").send(body);
}

async function payAndConfirm(member: ReturnType<typeof as>, groupId: string, round = 1) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "MOOV_TG" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await webhook(delivery.body, delivery.signature);
  return { contributionId: paid.body.id as string, delivery };
}

describe("the calendar of rounds", () => {
  it("writes one round per member when the group starts, each paid to the member whose turn it is", async () => {
    const { akossiwa, groupId } = await activeGroup();
    const group = (await akossiwa.get(`/v1/groups/${groupId}`)).body;
    const rounds = (await akossiwa.get(`/v1/groups/${groupId}/rounds`)).body;

    const byTurn = [...group.seats].sort((a, b) => a.payoutPosition - b.payoutPosition).map((s) => s.displayName);
    expect(rounds.map((r: { beneficiaryName: string }) => r.beneficiaryName)).toEqual(byTurn);
    expect(rounds.map((r: { number: number }) => r.number)).toEqual([1, 2, 3]);
  });

  it("is due on the first Friday after the start, then every week (D44)", async () => {
    const { akossiwa, groupId } = await activeGroup();
    const rounds = (await akossiwa.get(`/v1/groups/${groupId}/rounds`)).body;

    const first = firstDueDate(new Date(), "WEEKLY", 5);
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(rounds.map((r: { dueDate: string }) => r.dueDate)).toEqual([
      isoDay(first),
      isoDay(new Date(first.getTime() + week)),
      isoDay(new Date(first.getTime() + 2 * week)),
    ]);
    expect(rounds[0]).toMatchObject({ isCurrent: true, potFcfa: 15000, collectedFcfa: 0, myStatus: "UNPAID" });
  });
});

describe("paying a contribution", () => {
  it("sends a request for 5 000 FCFA to her own number and waits for her confirmation", async () => {
    const { abla, groupId } = await activeGroup();
    const res = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ roundNumber: 1, amountFcfa: 5000, operator: "TOGOCEL", status: "PENDING", receiptRef: null });
    const sent = [...mockPayments.transactions.values()].at(-1);
    expect(sent).toMatchObject({ amountFcfa: 5000, phone: "+22890000002", operator: "TOGOCEL" });
  });

  it("records the payment once the provider confirms it, writes a ledger line, and sends a receipt", async () => {
    const { abla, groupId, ids } = await activeGroup();
    await payAndConfirm(abla, groupId);

    const round = (await abla.get(`/v1/groups/${groupId}/rounds/1`)).body;
    expect(round).toMatchObject({ paidCount: 1, collectedFcfa: 5000, myStatus: "PAID" });
    const ledger = await prisma.ledgerEntry.findMany({ where: { groupId } });
    expect(ledger).toEqual([expect.objectContaining({ type: "CONTRIBUTION", amountFcfa: 5000, userId: ids.abla })]);

    const receipt = outbox.at(-1);
    expect(receipt?.to).toBe("+22890000002");
    expect(receipt?.text).toContain("5 000 FCFA");
    expect(receipt?.text).toContain("tour 1");
    expect(receipt?.text).toContain("FUCEC-Togo");
  });

  it("credits a payment once, however many times the webhook arrives or she checks (D45)", async () => {
    const { abla, groupId } = await activeGroup();
    const { contributionId, delivery } = await payAndConfirm(abla, groupId);

    await webhook(delivery.body, delivery.signature);
    await webhook(delivery.body, delivery.signature);
    await abla.post(`/v1/contributions/${contributionId}/check`);

    expect(await prisma.ledgerEntry.count({ where: { groupId } })).toBe(1);
  });

  it("refuses a webhook with a wrong signature and credits nothing", async () => {
    const { abla, groupId } = await activeGroup();
    const paid = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
    const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");

    // Flips the first character of the signature, so the forged one always differs.
    const forgedSignature = delivery.signature.replace(/s=(.)/, (_m, first: string) => `s=${first === "0" ? "1" : "0"}`);
    const forged = await webhook(delivery.body, forgedSignature);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe("WEBHOOK_INVALID");
    expect(await prisma.ledgerEntry.count({ where: { groupId } })).toBe(0);
  });

  it("does not credit a payment whose amount differs from the contribution", async () => {
    const { abla, groupId, ids } = await activeGroup();
    const paid = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
    const delivery = mockPayments.settle(contribution.providerRef as string, "PAID", 500);
    await webhook(delivery.body, delivery.signature);

    expect(await prisma.ledgerEntry.count({ where: { groupId } })).toBe(0);
    const flagged = await prisma.auditEvent.findFirst({ where: { userId: ids.abla, type: "PAYMENT_AMOUNT_MISMATCH" } });
    expect(flagged).not.toBeNull();
  });

  it("marks a declined payment as failed, and lets her try again", async () => {
    const { abla, groupId } = await activeGroup();
    const paid = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
    const delivery = mockPayments.settle(contribution.providerRef as string, "FAILED");
    await webhook(delivery.body, delivery.signature);

    expect((await abla.get(`/v1/groups/${groupId}/rounds/1`)).body.myStatus).toBe("FAILED");
    expect((await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" })).status).toBe(202);
  });

  it("finds a payment whose webhook was lost when she checks", async () => {
    const { abla, groupId } = await activeGroup();
    const paid = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
    mockPayments.settle(contribution.providerRef as string, "PAID"); // the webhook never arrives

    const checked = await abla.post(`/v1/contributions/${paid.body.id}/check`);
    expect(checked.body).toMatchObject({ status: "PAID", receiptRef: expect.any(String) });
  });
});

describe("what can and cannot be paid", () => {
  it("refuses a second payment for a round already paid", async () => {
    const { abla, groupId } = await activeGroup();
    await payAndConfirm(abla, groupId);

    const res = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_PAID");
  });

  it("does not send a second request while the first waits for her confirmation", async () => {
    const { abla, groupId } = await activeGroup();
    await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });

    const res = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_IN_PROGRESS");
  });

  it("refuses a round whose turn has not come, and accepts a late one", async () => {
    const { abla, groupId } = await activeGroup();
    const early = await abla.post(`/v1/groups/${groupId}/rounds/2/pay`, { operator: "MOOV_TG" });
    expect(early.body.error.code).toBe("ROUND_NOT_OPEN");

    // Round 1's Friday has passed: round 2 is now open, and round 1 can still be paid late.
    await prisma.round.updateMany({ where: { groupId, number: 1 }, data: { dueDate: new Date("2026-01-02") } });
    expect((await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" })).status).toBe(202);
    expect((await abla.post(`/v1/groups/${groupId}/rounds/2/pay`, { operator: "MOOV_TG" })).status).toBe(202);
  });

  it("tells someone without a seat that the group does not exist", async () => {
    const { akossiwa, abla } = await activeGroup();
    // A second group of Akossiwa's, where Abla has no seat.
    const otherId = (await akossiwa.post("/v1/groups", { ...SMALL_GROUP, name: "Tissus Bè" })).body.id as string;

    expect((await abla.get(`/v1/groups/${otherId}/rounds`)).status).toBe(404);
    expect((await abla.post(`/v1/groups/${otherId}/rounds/1/pay`, { operator: "MOOV_TG" })).status).toBe(404);
  });

  it("refuses payments before the group has started", async () => {
    const { akossiwa } = await activeGroup();
    const draftId = (await akossiwa.post("/v1/groups", { ...SMALL_GROUP, name: "Tissus Bè" })).body.id as string;

    const res = await akossiwa.post(`/v1/groups/${draftId}/rounds/1/pay`, { operator: "MOOV_TG" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });
});

describe("what each person sees", () => {
  it("tells each member on home what she owes this round, and whose turn it is", async () => {
    const { abla, groupId, ids } = await activeGroup();
    const before = (await abla.get("/v1/groups")).body.find((g: { id: string }) => g.id === groupId);
    const round1 = await prisma.round.findFirstOrThrow({ where: { groupId, number: 1 } });
    expect(before.currentRound).toMatchObject({
      number: 1,
      myStatus: "UNPAID",
      potFcfa: 15000,
      isMyTurn: round1.beneficiaryId === ids.abla,
    });

    await payAndConfirm(abla, groupId);
    const after = (await abla.get("/v1/groups")).body.find((g: { id: string }) => g.id === groupId);
    expect(after.currentRound.myStatus).toBe("PAID");
  });

  it("shows every member every payment in the round, by display name", async () => {
    const { abla, koffi, groupId } = await activeGroup();
    await payAndConfirm(abla, groupId);

    const round = (await koffi.get(`/v1/groups/${groupId}/rounds/1`)).body;
    const statusOf = (name: string) => round.payments.find((p: { displayName: string }) => p.displayName === name)?.status;
    expect(statusOf("Abla")).toBe("PAID");
    expect(statusOf("Koffi")).toBe("UNPAID");
    expect(round.myStatus).toBe("UNPAID");
  });

  it("shows the ledger to the group, newest first", async () => {
    const { abla, koffi, groupId } = await activeGroup();
    await payAndConfirm(abla, groupId);
    await payAndConfirm(koffi, groupId);

    const ledger = (await abla.get(`/v1/groups/${groupId}/ledger`)).body;
    expect(ledger.map((line: { memberName: string }) => line.memberName)).toEqual(["Koffi", "Abla"]);
    expect(ledger[0]).toMatchObject({ type: "CONTRIBUTION", amountFcfa: 5000, roundNumber: 1 });
  });
});

describe("the ledger is append-only (D5)", () => {
  it("is refused by the database itself if anything tries to change or delete a line", async () => {
    const { abla, groupId } = await activeGroup();
    await payAndConfirm(abla, groupId);
    const line = await prisma.ledgerEntry.findFirstOrThrow({ where: { groupId } });

    await expect(prisma.ledgerEntry.update({ where: { id: line.id }, data: { amountFcfa: 50000 } })).rejects.toThrow();
    await expect(prisma.ledgerEntry.delete({ where: { id: line.id } })).rejects.toThrow();
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: line.id } })).amountFcfa).toBe(5000);
  });
});
