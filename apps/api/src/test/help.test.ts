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
  const ask = (client: Client, body: object) =>
    client.post("/v1/me/loans", body);
  // A small JPEG-like payload is enough: the server checks type and size.
  const photo = {
    mime: "image/jpeg",
    base64: Buffer.from("fake jpeg bytes for a test").toString("base64"),
  };
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
    expect(
      page.checks.find((c: { key: string }) => c.key === "CYCLE_OR_STREAK"),
    ).toMatchObject({
      ok: false,
      figures: { cycles: 0, minCycles: 1, streak: 0, minStreak: 8 },
    });
    expect(
      (await ask(abla, { amountFcfa: 20000, purpose: "STOCK", months: 6 }))
        .status,
    ).toBe(409);
  });

  it("follows the MFI's own conditions, set by its administrator", async () => {
    const { abla } = await qualified();
    const admin = await officer("ADMIN");
    const policy = (await admin.get("/v1/console/credit-policy")).body;
    expect(policy).toMatchObject({
      minOnTimePct: 90,
      ceilingTimesPot: 3,
      months: [3, 6, 12],
    });
    expect(policy.documents.length).toBeGreaterThan(0);

    const stricter = {
      ...policy,
      minCycles: 2,
      minStreak: 20,
      ceilingTimesPot: 2,
      months: [6, 12],
    };
    delete stricter.updatedAt;
    delete stricter.updatedByName;
    expect(
      (await admin.post("/v1/console/credit-policy/preview", stricter)).body,
    ).toEqual({ eligible: 0, members: 3 });
    expect(
      (await put(admin.token, "/v1/console/credit-policy", stricter)).status,
    ).toBe(200);

    const page = (await abla.get("/v1/me/loans")).body;
    expect(page).toMatchObject({
      eligible: false,
      ceilingFcfa: 30000,
      months: [6, 12],
    });
    expect(
      await prisma.auditEvent.count({
        where: { type: "STAFF_CREDIT_POLICY_CHANGED" },
      }),
    ).toBe(1);
  });

  it("lets only an administrator change the conditions", async () => {
    await activeGroup();
    const desk = await officer();
    const policy = (await desk.get("/v1/console/credit-policy")).body;
    delete policy.updatedAt;
    delete policy.updatedByName;
    expect(
      (await put(desk.token, "/v1/console/credit-policy", policy)).status,
    ).toBe(403);
  });

  it("goes from request to preselection, documents, the agency and the outcome", async () => {
    const { abla, ablaToken } = await qualified();
    expect(
      (await ask(abla, { amountFcfa: 50000, purpose: "STOCK", months: 6 }))
        .status,
    ).toBe(400);
    expect(
      (await ask(abla, { amountFcfa: 40000, purpose: "STOCK", months: 6 }))
        .status,
    ).toBe(201);
    expect((await abla.get("/v1/me/loans")).body.eligible).toBe(false); // one open request at a time

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
    expect(detail.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    expect(detail.checks.map((c: { key: string }) => c.key)).toContain(
      "CEILING",
    );

    // Preselection, not a loan: she is asked for her documents.
    await desk.post(`/v1/console/loans/${loan.id}/decide`, {
      action: "preselect",
    });
    let mine = (await abla.get("/v1/me/loans")).body.requests[0];
    expect(mine).toMatchObject({
      status: "PRESELECTED",
      documentsConsented: false,
      documentsComplete: false,
    });
    const keys = mine.documents.map((d: { key: string }) => d.key);
    expect(
      mine.documents.every((d: { status: string }) => d.status === "MISSING"),
    ).toBe(true);

    // Photos only after her consent, and only images of a sensible size.
    expect(
      (
        await put(
          ablaToken,
          `/v1/me/loans/${loan.id}/documents/${keys[0]}`,
          photo,
        )
      ).status,
    ).toBe(409);
    await abla.post(`/v1/me/loans/${loan.id}/documents-consent`);
    expect(
      (
        await put(ablaToken, `/v1/me/loans/${loan.id}/documents/${keys[0]}`, {
          mime: "application/pdf",
          base64: photo.base64,
        })
      ).status,
    ).toBe(400);
    for (const key of keys) {
      expect(
        (
          await put(
            ablaToken,
            `/v1/me/loans/${loan.id}/documents/${key}`,
            photo,
          )
        ).status,
      ).toBe(200);
    }

    // The officer opens each photo (logged), asks for one again, accepts the rest.
    const docs = (await desk.get(`/v1/console/loans/${loan.id}`)).body
      .documents;
    const opened = await desk.get(
      `/v1/console/loans/${loan.id}/documents/${docs[0].id}`,
    );
    expect(opened.status).toBe(200);
    expect(opened.headers["content-type"]).toContain("image/jpeg");
    expect(
      await prisma.auditEvent.count({
        where: { type: "STAFF_LOAN_DOCUMENT_VIEWED" },
      }),
    ).toBe(1);
    await desk.post(
      `/v1/console/loans/${loan.id}/documents/${docs[0].id}/review`,
      { accepted: false, note: "Photo floue" },
    );
    mine = (await abla.get("/v1/me/loans")).body.requests[0];
    expect(mine.documents[0]).toMatchObject({
      status: "REDO",
      note: "Photo floue",
    });
    await put(ablaToken, `/v1/me/loans/${loan.id}/documents/${keys[0]}`, photo);
    const again = (await desk.get(`/v1/console/loans/${loan.id}`)).body
      .documents;
    for (const d of again)
      await desk.post(`/v1/console/loans/${loan.id}/documents/${d.id}/review`, {
        accepted: true,
      });
    expect(
      (await abla.get("/v1/me/loans")).body.requests[0].documentsComplete,
    ).toBe(true);

    // After the meeting at the agency: the outcome.
    expect(
      (
        await desk.post(`/v1/console/loans/${loan.id}/decide`, {
          action: "grant",
          grantedFcfa: 45000,
        })
      ).status,
    ).toBe(400);
    const granted = (
      await desk.post(`/v1/console/loans/${loan.id}/decide`, {
        action: "grant",
        grantedFcfa: 35000,
      })
    ).body;
    expect(granted).toMatchObject({ status: "GRANTED", grantedFcfa: 35000 });

    // 30 days after the file was complete, the photos are gone.
    const { purgeLoanDocuments } = await import("../services/loanService.js");
    expect(
      await purgeLoanDocuments(new Date(Date.now() + 31 * 86_400_000)),
    ).toBe(keys.length);
    const after = (await desk.get(`/v1/console/loans/${loan.id}`)).body
      .documents;
    expect(
      after.every(
        (d: { id: string | null; deleted: boolean }) =>
          d.id === null && d.deleted,
      ),
    ).toBe(true);
  });

  it("makes her wait after a refusal", async () => {
    const { abla } = await qualified();
    await ask(abla, { amountFcfa: 20000, purpose: "EQUIPMENT", months: 3 });
    const desk = await officer();
    const [loan] = (await desk.get("/v1/console/loans")).body;
    await desk.post(`/v1/console/loans/${loan.id}/decide`, {
      action: "decline",
      reason: "Revenez avec un devis du congélateur",
    });
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.requests[0]).toMatchObject({
      status: "DECLINED",
      decisionNote: "Revenez avec un devis du congélateur",
    });
    expect(
      page.checks.find((c: { key: string }) => c.key === "WAIT_AFTER_REFUSAL"),
    ).toMatchObject({
      ok: false,
      figures: { days: 0, wait: 30 },
    });
  });

  it("asks no length, lists the documents first, and lets a document come on paper (D118)", async () => {
    const { abla, ablaToken } = await qualified();
    const page = (await abla.get("/v1/me/loans")).body;
    expect(page.eligible).toBe(true);
    expect(page.documents.length).toBeGreaterThan(0);

    expect((await ask(abla, { amountFcfa: 30000, purpose: "STOCK" })).status).toBe(201);
    const desk = await officer();
    const [loan] = (await desk.get("/v1/console/loans")).body;
    expect(loan.months).toBeNull();
    await desk.post(`/v1/console/loans/${loan.id}/decide`, { action: "preselect" });
    await abla.post(`/v1/me/loans/${loan.id}/documents-consent`);

    // Every document but one by photo, the last one on paper.
    const keys = (await abla.get("/v1/me/loans")).body.requests[0].documents.map((d: { key: string }) => d.key);
    for (const key of keys.slice(0, -1)) await put(ablaToken, `/v1/me/loans/${loan.id}/documents/${key}`, photo);
    const paper = await abla.post(`/v1/me/loans/${loan.id}/documents/${keys.at(-1)}/paper`);
    expect(paper.status).toBe(200);
    const detail = (await desk.get(`/v1/console/loans/${loan.id}`)).body;
    expect(detail.documents.at(-1)).toMatchObject({ status: "PAPER", id: null });

    // Once the photos are accepted, the file is complete: she goes to the agency.
    for (const d of detail.documents.filter((x: { status: string }) => x.status === "SENT"))
      await desk.post(`/v1/console/loans/${loan.id}/documents/${d.id}/review`, { accepted: true });
    expect((await abla.get("/v1/me/loans")).body.requests[0].documentsComplete).toBe(true);
  });
});
