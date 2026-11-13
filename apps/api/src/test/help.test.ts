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

// Help inside the group (D87 swaps) and microloans (D89).

if (
  !(mfi instanceof MockMfiAdapter) ||
  !(payments instanceof MockPaymentProvider)
) {
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

function as(accessToken: string) {
  const auth = (req: request.Test) =>
    req.set("Authorization", `Bearer ${accessToken}`);
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

// Akossiwa (organiser), Abla and Koffi, in a started group at Caisse Mawuli.
async function activeGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const [akossiwa, abla, koffi] = people.map((p) =>
    as(p.tokens.accessToken),
  ) as [Client, Client, Client];
  const groupId = (await akossiwa.post("/v1/groups", SMALL_GROUP)).body
    .id as string;
  await akossiwa.post(`/v1/groups/${groupId}/invites`, {
    phone: "+22890000002",
  });
  await akossiwa.post(`/v1/groups/${groupId}/invites`, {
    phone: "+22890000003",
  });
  await akossiwa.post(`/v1/groups/${groupId}/propose`, { shareConsent: true });
  await abla.post(`/v1/groups/${groupId}/accept`, {
    version: 1,
    shareConsent: true,
  });
  await koffi.post(`/v1/groups/${groupId}/accept`, {
    version: 1,
    shareConsent: true,
  });
  await akossiwa.post(`/v1/groups/${groupId}/start`);
  const seats = await prisma.membership.findMany({
    where: { groupId },
    include: { user: true },
  });
  const id = (name: string) =>
    seats.find((s) => s.user.displayName === name)?.userId as string;
  const turn = (name: string) =>
    seats.find((s) => s.user.displayName === name)?.payoutPosition as number;
  return {
    groupId,
    akossiwa,
    abla,
    koffi,
    id,
    turn,
    ablaToken: people[1]?.tokens.accessToken as string,
  };
}

async function pay(member: Client, groupId: string, round: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, {
    operator: "TOGOCEL",
  });
  const contribution = await prisma.contribution.findUniqueOrThrow({
    where: { id: paid.body.id },
  });
  const delivery = mockPayments.settle(
    contribution.providerRef as string,
    "PAID",
  );
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
}

async function officer(role: "OFFICER" | "ADMIN" = "OFFICER") {
  const email =
    role === "ADMIN" ? "kafui@mawuli.example" : "mawuli@mawuli.example";
  const { password, totpSecret } = await createStaff({
    mfiCode: "MAWULI",
    email,
    name: "Mawuli Adzo",
    role,
  });
  await prisma.staffUser.update({
    where: { email },
    data: { mustChangePassword: false },
  });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  const login = await request(app)
    .post("/v1/staff/login")
    .send({ email, password, code });
  return {
    ...as(login.body.accessToken),
    token: login.body.accessToken as string,
  };
}

describe("swapping turns (D87)", () => {
  it("swaps two members' turns once the partner agrees and the organiser confirms", async () => {
    const { groupId, akossiwa, abla, koffi, id, turn } = await activeGroup();
    const ablaTurn = turn("Abla");
    const koffiTurn = turn("Koffi");

    const help = (await abla.get(`/v1/groups/${groupId}/help`)).body;
    expect(help.canSwap).toBe(true);
    expect(help.swapPartners.map((p: { name: string }) => p.name)).toContain(
      "Koffi",
    );

    expect(
      (
        await abla.post(`/v1/groups/${groupId}/swaps`, {
          partnerId: id("Koffi"),
        })
      ).status,
    ).toBe(201);
    // One open swap at a time for each of them.
    expect(
      (
        await abla.post(`/v1/groups/${groupId}/swaps`, {
          partnerId: id("Akossiwa"),
        })
      ).status,
    ).toBe(409);

    const asked = (await koffi.get(`/v1/groups/${groupId}/help`)).body.swaps[0];
    expect(asked).toMatchObject({ status: "ASKED", canAnswer: true });
    await koffi.post(`/v1/groups/${groupId}/swaps/${asked.id}/answer`, {
      yes: true,
    });

    const agreed = (await akossiwa.get(`/v1/groups/${groupId}/help`)).body
      .swaps[0];
    expect(agreed).toMatchObject({ status: "AGREED", canConfirm: true });
    expect(
      (
        await abla.post(`/v1/groups/${groupId}/swaps/${asked.id}/decide`, {
          yes: true,
        })
      ).status,
    ).toBe(403);
    await akossiwa.post(`/v1/groups/${groupId}/swaps/${asked.id}/decide`, {
      yes: true,
    });

    const after = await prisma.membership.findMany({
      where: { groupId },
      include: { user: true },
    });
    expect(
      after.find((m) => m.user.displayName === "Abla")?.payoutPosition,
    ).toBe(koffiTurn);
    expect(
      after.find((m) => m.user.displayName === "Koffi")?.payoutPosition,
    ).toBe(ablaTurn);
    const round = await prisma.round.findUniqueOrThrow({
      where: { groupId_number: { groupId, number: koffiTurn } },
    });
    expect(round.beneficiaryId).toBe(id("Abla"));
    expect(
      await prisma.groupMessage.count({
        where: { groupId, event: "TURN_SWAPPED" },
      }),
    ).toBe(2);
  });

  it("refuses a swap for a turn that is already due or paid out", async () => {
    const { groupId, abla, id, turn } = await activeGroup();
    await prisma.round.update({
      where: { groupId_number: { groupId, number: turn("Koffi") } },
      data: { dueDate: new Date("2026-01-02T00:00:00Z") },
    });
    expect(
      (
        await abla.post(`/v1/groups/${groupId}/swaps`, {
          partnerId: id("Koffi"),
        })
      ).status,
    ).toBe(409);
  });
});

describe("no advance from the group's money (D115)", () => {
  it("no longer offers one: the help shows swaps only, and the old address is gone", async () => {
    const { groupId, abla } = await activeGroup();
    const help = (await abla.get(`/v1/groups/${groupId}/help`)).body;
    expect(help).not.toHaveProperty("canAskAdvance");
    expect(help).not.toHaveProperty("advances");
    expect((await abla.post(`/v1/groups/${groupId}/advances`, { amountFcfa: 2000 })).status).toBe(404);
  });
});

describe("microloan requests (D89, D91)", () => {
  const BUSINESS = { kind: "FABRICS", since: "OVER_3Y", weeklySalesFcfa: 60000, place: "Assigamé, Bè" };
  const ask = (client: Client, body: object) =>
    client.post("/v1/me/loans", { business: BUSINESS, ...body });
  const put = (token: string, path: string, body: object) =>
    request(app).put(path).set("Authorization", `Bearer ${token}`).send(body);

  async function qualified() {
    const ctx = await activeGroup();
    await pay(ctx.abla, ctx.groupId, 1);
    const group = await prisma.group.update({
      where: { id: ctx.groupId },
      data: { state: "COMPLETED" },
    });
    // D125: she has started saving at the MFI, which a loan asks by default.
    const membership = await prisma.membership.findFirstOrThrow({
      where: { groupId: ctx.groupId, user: { displayName: "Abla" } },
    });
    await prisma.savingsAccount.create({
      data: {
        userId: membership.userId,
        mfiId: group.mfiId as string,
        ref: `EP-T-${membership.userId.slice(0, 8)}`,
        status: "OPEN",
        consentAt: new Date(),
        openedAt: new Date(),
        entries: { create: { kind: "POT_KEPT", pocket: "LOCKED", amountFcfa: 5000, lockMonths: 3 } },
      },
    });
    return ctx;
  }

  it("is closed to a member without a record yet, and says why", async () => {
    const { abla } = await activeGroup();
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.eligible).toBe(false);
    expect(page.checks.find((c: { key: string }) => c.key === "CYCLE_OR_STREAK")).toMatchObject({
      ok: false,
      figures: { cycles: 0, minCycles: 1, streak: 0, minStreak: 8 },
    });
    expect((await ask(abla, { amountFcfa: 20000, purpose: "STOCK" })).status).toBe(409);
  });

  it("follows the MFI's own conditions, set by its administrator", async () => {
    const { abla } = await qualified();
    const admin = await officer("ADMIN");
    const policy = (await admin.get("/v1/console/credit-policy")).body;
    expect(policy).toMatchObject({ minOnTimePct: 90, ceilingTimesPot: 3 });
    expect(policy.documents.length).toBeGreaterThan(0);

    const stricter = { ...policy, minCycles: 2, minStreak: 20, ceilingTimesPot: 2 };
    delete stricter.updatedAt;
    delete stricter.updatedByName;
    expect((await admin.post("/v1/console/credit-policy/preview", stricter)).body).toEqual({ eligible: 0, members: 3 });
    expect((await put(admin.token, "/v1/console/credit-policy", stricter)).status).toBe(200);

    const page = (await abla.get("/v1/me/loans")).body;
    expect(page).toMatchObject({ eligible: false, ceilingFcfa: 30000 });
    expect(await prisma.auditEvent.count({ where: { type: "STAFF_CREDIT_POLICY_CHANGED" } })).toBe(1);
  });

  it("lets only an administrator change the conditions", async () => {
    await activeGroup();
    const desk = await officer();
    const policy = (await desk.get("/v1/console/credit-policy")).body;
    delete policy.updatedAt;
    delete policy.updatedByName;
    expect((await put(desk.token, "/v1/console/credit-policy", policy)).status).toBe(403);
  });

  it("asks for her business with the request", async () => {
    const { abla } = await qualified();
    expect((await abla.post("/v1/me/loans", { amountFcfa: 20000, purpose: "STOCK" })).status).toBe(400);
    expect((await ask(abla, { amountFcfa: 20000, purpose: "STOCK", business: { ...BUSINESS, weeklySalesFcfa: 0 } })).status).toBe(400);
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.business).toBeNull();
    expect(page.place).toBeTruthy();
  });

  it("goes from request to preselection, then to signing at the agency", async () => {
    const { abla } = await qualified();
    expect((await ask(abla, { amountFcfa: 50000, purpose: "STOCK" })).status).toBe(400);
    expect((await ask(abla, { amountFcfa: 40000, purpose: "STOCK" })).status).toBe(201);
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.eligible).toBe(false); // one open request at a time
    expect(page.business).toEqual(BUSINESS); // her answers, to start from next time

    const desk = await officer();
    const [loan] = (await desk.get("/v1/console/loans")).body;
    expect(loan).toMatchObject({ memberName: ABLA.legalName, amountFcfa: 40000, status: "PENDING", business: BUSINESS });
    const detail = (await desk.get(`/v1/console/loans/${loan.id}`)).body;
    expect(detail).toMatchObject({ cyclesCompleted: 1, paymentsMade: 1, paymentsOnTime: 1, owesFcfa: 0, toBring: [] });
    expect(detail.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(detail.checks.map((c: { key: string }) => c.key)).toContain("CEILING");

    // Preselected: she is told what to bring to sign at the agency.
    await desk.post(`/v1/console/loans/${loan.id}/decide`, { action: "preselect" });
    const mine = (await abla.get("/v1/me/loans")).body.requests[0];
    expect(mine.status).toBe("PRESELECTED");
    expect(mine.toBring.length).toBeGreaterThan(0);

    // At the agency, once she has signed.
    expect((await desk.post(`/v1/console/loans/${loan.id}/decide`, { action: "grant", grantedFcfa: 45000 })).status).toBe(400);
    const granted = (await desk.post(`/v1/console/loans/${loan.id}/decide`, { action: "grant", grantedFcfa: 35000 })).body;
    expect(granted).toMatchObject({ status: "GRANTED", grantedFcfa: 35000, toBring: [] });
  });

  it("makes her wait after a refusal, at the first look or at the agency", async () => {
    const { abla } = await qualified();
    await ask(abla, { amountFcfa: 20000, purpose: "EQUIPMENT" });
    const desk = await officer();
    const [loan] = (await desk.get("/v1/console/loans")).body;
    await desk.post(`/v1/console/loans/${loan.id}/decide`, { action: "preselect" });
    await desk.post(`/v1/console/loans/${loan.id}/decide`, { action: "notGranted", reason: "Revenez avec un devis du congélateur" });
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.requests[0]).toMatchObject({ status: "NOT_GRANTED", decisionNote: "Revenez avec un devis du congélateur" });
    expect(page.checks.find((c: { key: string }) => c.key === "WAIT_AFTER_REFUSAL")).toMatchObject({
      ok: false,
      figures: { days: 0, wait: 30 },
    });
  });
});
