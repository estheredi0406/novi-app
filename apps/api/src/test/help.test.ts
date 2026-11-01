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

// Help inside the group (D87 swaps, D88 advances) and microloans (D89).

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

// Akossiwa (organiser), Abla and Koffi, in a started group at FUCEC-Togo.
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
  return { groupId, akossiwa, abla, koffi, id, turn };
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

async function officer() {
  const email = "mawuli@fucec.example";
  const { password, totpSecret } = await createStaff({
    mfiCode: "FUCEC",
    email,
    name: "Mawuli Adzo",
  });
  await prisma.staffUser.update({
    where: { email },
    data: { mustChangePassword: false },
  });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  const login = await request(app)
    .post("/v1/staff/login")
    .send({ email, password, code });
  return as(login.body.accessToken);
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

describe("an advance from the solidarity fund (D88)", () => {
  // The fund is shared by every group at the MFI; a test fills it directly.
  async function fillFund(groupId: string, amountFcfa: number) {
    await prisma.ledgerEntry.create({
      data: { groupId, type: "RESERVE_IN", amountFcfa, note: "test" },
    });
  }

  it("is approved by the organiser and one member, sent by the officer, and repaid from her pot", async () => {
    const { groupId, akossiwa, abla, koffi, id, turn } = await activeGroup();
    await fillFund(groupId, 20_000);

    const before = (await abla.get(`/v1/groups/${groupId}/help`)).body;
    expect(before).toMatchObject({ canAskAdvance: true, advanceMaxFcfa: 5000 });
    expect(
      (await abla.post(`/v1/groups/${groupId}/advances`, { amountFcfa: 6000 }))
        .status,
    ).toBe(400);
    expect(
      (
        await abla.post(`/v1/groups/${groupId}/advances`, {
          amountFcfa: 4000,
          reason: "Ma fille est malade",
        })
      ).status,
    ).toBe(201);

    const advance = (await koffi.get(`/v1/groups/${groupId}/help`)).body
      .advances[0];
    expect(advance).toMatchObject({
      borrowerName: "Abla",
      amountFcfa: 4000,
      canApprove: true,
      approvals: 0,
    });
    expect(
      (
        await abla.post(`/v1/groups/${groupId}/advances/${advance.id}/decide`, {
          yes: true,
        })
      ).status,
    ).toBe(409);
    await koffi.post(`/v1/groups/${groupId}/advances/${advance.id}/decide`, {
      yes: true,
    });
    // A second member alone is not enough: the organiser must approve.
    expect(
      (await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } }))
        .status,
    ).toBe("ASKED");
    await akossiwa.post(`/v1/groups/${groupId}/advances/${advance.id}/decide`, {
      yes: true,
    });
    expect(
      (await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } }))
        .status,
    ).toBe("APPROVED");

    const desk = await officer();
    const listed = (await desk.get("/v1/console/advances")).body;
    expect(listed).toEqual([
      expect.objectContaining({
        id: advance.id,
        status: "APPROVED",
        receiverTurn: turn("Abla"),
      }),
    ]);
    expect(
      (await desk.post(`/v1/console/advances/${advance.id}/send`)).status,
    ).toBe(200);
    expect(
      (await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } }))
        .status,
    ).toBe("PAID");

    // While she owes it, she cannot ask again.
    expect(
      (await abla.get(`/v1/groups/${groupId}/help`)).body.canAskAdvance,
    ).toBe(false);

    // On her turn, her pot repays it first.
    const ablaTurn = turn("Abla");
    for (let r = 1; r <= ablaTurn; r += 1) {
      for (const member of [akossiwa, abla, koffi])
        await pay(member, groupId, r);
      await prisma.round.update({
        where: { groupId_number: { groupId, number: r } },
        data: { dueDate: new Date("2026-01-02T00:00:00Z") },
      });
      await runPayouts();
      const payout = await prisma.payout.findFirstOrThrow({
        where: { round: { groupId, number: r } },
      });
      await releasePayout(payout.id, null);
    }
    const herPayout = await prisma.payout.findFirstOrThrow({
      where: { round: { groupId, number: ablaTurn } },
    });
    expect(herPayout.beneficiaryId).toBe(id("Abla"));
    expect(herPayout.coverRepaidFcfa).toBe(4000);
    expect(
      (await prisma.advance.findUniqueOrThrow({ where: { id: advance.id } }))
        .status,
    ).toBe("REPAID");
  });

  it("is refused to a member who is behind with her payments", async () => {
    const { groupId, abla } = await activeGroup();
    await fillFund(groupId, 20_000);
    await prisma.round.update({
      where: { groupId_number: { groupId, number: 1 } },
      data: { dueDate: new Date("2026-01-02T00:00:00Z") },
    });
    // Round 1 has passed and she has not paid it; her own turn may be round 1
    // too, which also closes the door. Either way: no advance.
    expect(
      (await abla.post(`/v1/groups/${groupId}/advances`, { amountFcfa: 2000 }))
        .status,
    ).toBe(409);
  });

  it("caps the advance at what the fund holds", async () => {
    const { groupId, abla } = await activeGroup();
    await fillFund(groupId, 300);
    const help = (await abla.get(`/v1/groups/${groupId}/help`)).body;
    if (help.myRound !== 1)
      expect(help).toMatchObject({ canAskAdvance: false, fundTooLow: true });
  });
});

describe("microloan requests (D89)", () => {
  it("is closed to a member without a record yet", async () => {
    const { abla } = await activeGroup();
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.eligible).toBe(false);
    expect(
      page.checks.find((c: { key: string }) => c.key === "CYCLE_OR_STREAK").ok,
    ).toBe(false);
    expect(
      (
        await abla.post("/v1/me/loans", {
          amountFcfa: 20000,
          purpose: "STOCK",
          months: 6,
        })
      ).status,
    ).toBe(409);
  });

  it("lets a member with a finished tontine ask, and the officer decide with her record", async () => {
    const { groupId, abla } = await activeGroup();
    await pay(abla, groupId, 1);
    await prisma.group.update({
      where: { id: groupId },
      data: { state: "COMPLETED" },
    });

    const page = (await abla.get("/v1/me/loans")).body;
    expect(page).toMatchObject({
      eligible: true,
      ceilingFcfa: 44100,
      onTimePercent: 100,
    });
    expect(
      (
        await abla.post("/v1/me/loans", {
          amountFcfa: 50000,
          purpose: "STOCK",
          months: 6,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await abla.post("/v1/me/loans", {
          amountFcfa: 40000,
          purpose: "STOCK",
          months: 6,
        })
      ).status,
    ).toBe(201);
    // One open request at a time.
    expect((await abla.get("/v1/me/loans")).body.eligible).toBe(false);

    const desk = await officer();
    const [loan] = (await desk.get("/v1/console/loans")).body;
    expect(loan).toMatchObject({
      memberName: ABLA.legalName,
      amountFcfa: 40000,
      status: "PENDING",
    });
    const detail = (await desk.get(`/v1/console/loans/${loan.id}`)).body;
    expect(detail).toMatchObject({
      cyclesCompleted: 1,
      paymentsMade: 1,
      paymentsOnTime: 1,
      owesFcfa: 0,
    });

    expect(
      (
        await desk.post(`/v1/console/loans/${loan.id}/approve`, {
          grantedFcfa: 45000,
        })
      ).status,
    ).toBe(400);
    const decided = (
      await desk.post(`/v1/console/loans/${loan.id}/approve`, {
        grantedFcfa: 35000,
      })
    ).body;
    expect(decided).toMatchObject({ status: "APPROVED", grantedFcfa: 35000 });
    expect((await abla.get("/v1/me/loans")).body.requests[0]).toMatchObject({
      status: "APPROVED",
      grantedFcfa: 35000,
    });
  });

  it("makes her wait 30 days after a refusal", async () => {
    const { groupId, abla } = await activeGroup();
    await pay(abla, groupId, 1);
    await prisma.group.update({
      where: { id: groupId },
      data: { state: "COMPLETED" },
    });
    await abla.post("/v1/me/loans", {
      amountFcfa: 20000,
      purpose: "EQUIPMENT",
      months: 3,
    });
    const desk = await officer();
    const [loan] = (await desk.get("/v1/console/loans")).body;
    await desk.post(`/v1/console/loans/${loan.id}/decline`, {
      reason: "Revenez avec un devis du congélateur",
    });
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.requests[0]).toMatchObject({
      status: "DECLINED",
      decisionNote: "Revenez avec un devis du congélateur",
    });
    expect(
      page.checks.find((c: { key: string }) => c.key === "WAIT_AFTER_REFUSAL")
        .ok,
    ).toBe(false);
  });
});
