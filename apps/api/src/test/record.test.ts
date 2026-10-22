import { createPublicKey, verify } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { payments } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { runPayouts } from "../services/payoutService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(payments instanceof MockPaymentProvider)) throw new Error("Tests require the mock payment provider.");
const mockPayments = payments;

// Akossiwa's group of 3: 5 000 FCFA every Friday, so each pot is 15 000 FCFA.
const SMALL_GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };
const LONG_AGO = new Date("2026-01-02T00:00:00Z");

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}

type Member = ReturnType<typeof as>;

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

  return {
    groupId,
    akossiwa: organiser,
    abla: as(abla.tokens.accessToken),
    koffi: as(koffi.tokens.accessToken),
    ids: { akossiwa: akossiwa.member.id, abla: abla.member.id },
  };
}

async function pay(member: Member, groupId: string, round: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "MOOV_TG" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
}

// Moves a round's Friday into the past, before or after a payment.
const setDue = (groupId: string, number: number, dueDate: Date) =>
  prisma.round.update({ where: { groupId_number: { groupId, number } }, data: { dueDate } });

describe("her savings record", () => {
  it("starts empty, under the name on her ID", async () => {
    const { tokens } = await signedUpMember();
    const record = (await as(tokens.accessToken).get("/v1/me/record")).body;
    expect(record).toMatchObject({
      legalName: "Akossiwa Afi Mensah",
      groupsJoined: 0,
      paymentsMade: 0,
      missed: 0,
      totalSavedFcfa: 0,
      groups: [],
    });
  });

  it("counts a payment made before the due date as on time, with one line per group", async () => {
    const { abla, groupId } = await activeGroup();
    await pay(abla, groupId, 1);

    const record = (await abla.get("/v1/me/record")).body;
    expect(record).toMatchObject({ groupsJoined: 1, paymentsMade: 1, paidOnTime: 1, paidLate: 0, totalSavedFcfa: 5000 });
    expect(record.groups).toEqual([
      expect.objectContaining({ name: "Pagnes Assigamé", mfiName: "FUCEC-Togo", amountFcfa: 5000, paid: 1, onTime: 1 }),
    ]);
  });

  it("counts a payment after the due date as late, and a passed round with no payment as missed", async () => {
    const { abla, groupId } = await activeGroup();
    await setDue(groupId, 1, LONG_AGO); // round 1's Friday has passed
    await pay(abla, groupId, 1); // paid late
    await setDue(groupId, 2, new Date("2026-01-09T00:00:00Z")); // round 2 passed, never paid

    const record = (await abla.get("/v1/me/record")).body;
    expect(record).toMatchObject({ paymentsMade: 1, paidOnTime: 0, paidLate: 1, missed: 1 });
  });

  it("counts the pots she received", async () => {
    const { akossiwa, abla, koffi, groupId } = await activeGroup();
    for (const member of [akossiwa, abla, koffi]) await pay(member, groupId, 1);
    await setDue(groupId, 1, LONG_AGO);
    await runPayouts();

    const round = await prisma.round.findFirstOrThrow({ where: { groupId, number: 1 }, include: { beneficiary: true } });
    const receiver = [akossiwa, abla, koffi].at(["Akossiwa", "Abla", "Koffi"].indexOf(round.beneficiary.displayName)) as Member;
    expect((await receiver.get("/v1/me/record")).body).toMatchObject({ potsReceived: 1, totalReceivedFcfa: 15000 });
  });

  it("contains no phone number, no NIU, and nobody else's name", async () => {
    const { abla, groupId } = await activeGroup();
    await pay(abla, groupId, 1);

    const text = JSON.stringify((await abla.get("/v1/me/record")).body);
    for (const absent of ["+22890000002", "TEST-0002", "Akossiwa", "Koffi"]) expect(text).not.toContain(absent);
  });
});

describe("sharing it with a lender (D50)", () => {
  it("creates a signed snapshot, valid 30 days, that a lender sees as VALID with the same facts", async () => {
    const { abla, groupId } = await activeGroup();
    await pay(abla, groupId, 1);
    const share = (await abla.post("/v1/me/record/shares")).body;

    const days = (Date.parse(share.expiresAt) - Date.parse(share.issuedAt)) / 86_400_000;
    expect(days).toBe(30);
    const check = (await request(app).get(`/v1/verify/${share.id}`)).body;
    expect(check).toMatchObject({ status: "VALID", issuer: "Novi" });
    expect(check.record).toEqual((await abla.get("/v1/me/record")).body);
  });

  it("can be checked by anyone with Novi's public key", async () => {
    const { abla } = await activeGroup();
    const share = (await abla.post("/v1/me/record/shares")).body;
    const { publicKeyPem } = (await request(app).get("/v1/verify/public-key")).body;
    const stored = await prisma.recordShare.findUniqueOrThrow({ where: { id: share.id } });

    const key = createPublicKey(publicKeyPem);
    expect(verify(null, Buffer.from(stored.payloadText), key, Buffer.from(stored.signature, "base64url"))).toBe(true);
  });

  it("shows TAMPERED, and no facts, if a single number was changed", async () => {
    const { abla, groupId } = await activeGroup();
    await pay(abla, groupId, 1);
    const share = (await abla.post("/v1/me/record/shares")).body;
    const stored = await prisma.recordShare.findUniqueOrThrow({ where: { id: share.id } });
    await prisma.recordShare.update({
      where: { id: share.id },
      data: { payloadText: stored.payloadText.replace('"totalSavedFcfa":5000', '"totalSavedFcfa":500000') },
    });

    expect((await request(app).get(`/v1/verify/${share.id}`)).body).toMatchObject({ status: "TAMPERED", record: null });
  });

  it("shows nothing once she withdraws it, or once it has expired", async () => {
    const { abla } = await activeGroup();
    const withdrawn = (await abla.post("/v1/me/record/shares")).body;
    await abla.post(`/v1/me/record/shares/${withdrawn.id}/revoke`);
    expect((await request(app).get(`/v1/verify/${withdrawn.id}`)).body).toMatchObject({ status: "REVOKED", record: null });

    const old = (await abla.post("/v1/me/record/shares")).body;
    await prisma.recordShare.update({ where: { id: old.id }, data: { expiresAt: LONG_AGO } });
    expect((await request(app).get(`/v1/verify/${old.id}`)).body).toMatchObject({ status: "EXPIRED", record: null });
  });

  it("logs every opening, so she can see her record was looked at (D37)", async () => {
    const { abla } = await activeGroup();
    const share = (await abla.post("/v1/me/record/shares")).body;
    await request(app).get(`/v1/verify/${share.id}`);
    await request(app).get(`/verify/${share.id}`);

    const mine = (await abla.get("/v1/me/record/shares")).body;
    expect(mine).toEqual([expect.objectContaining({ id: share.id, views: 2, lastViewedAt: expect.any(String) })]);
  });

  it("lets nobody else withdraw her share", async () => {
    const { abla, koffi } = await activeGroup();
    const share = (await abla.post("/v1/me/record/shares")).body;
    expect((await koffi.post(`/v1/me/record/shares/${share.id}/revoke`)).status).toBe(404);
  });

  it("serves a page a loan officer can open on any phone, with every value escaped", async () => {
    const { abla } = await activeGroup();
    await prisma.user.updateMany({ where: { displayName: "Abla" }, data: { legalName: "Abla <script>alert(1)</script>" } });
    const share = (await abla.post("/v1/me/record/shares")).body;

    const page = await request(app).get(`/verify/${share.id}`);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.text).toContain("Relevé authentique et valide");
    expect(page.text).toContain("Abla &lt;script&gt;");
    expect(page.text).not.toContain("<script>alert(1)</script>");
  });
});
