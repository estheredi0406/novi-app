import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { payments, sms } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { SmsDesk } from "../providers/sms/SmsDesk.js";
import { toGsm } from "../providers/sms/TwilioSmsProvider.js";
import { runPayouts } from "../services/payoutService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// "Mes transactions": every franc she paid or received, the advance (D103),
// covered shares (D104), payments pending or not confirmed, and the SMS that
// tell her about money even without the app.

if (!(payments instanceof MockPaymentProvider) || !(sms instanceof MockSmsProvider)) {
  throw new Error("Tests require the mock payment and SMS providers.");
}
const mockPayments = payments;
const outbox = sms.sent;
const DAY = 24 * 60 * 60 * 1000;
const RULES = { name: "Marché de Bè", amountFcfa: 1000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
  };
}
type Client = ReturnType<typeof as>;

// Akossiwa, Abla and Koffi, started; today sits inside round 2.
async function startedGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const [akossiwa, abla, koffi] = people.map((p) => as(p.tokens.accessToken)) as [Client, Client, Client];
  const groupId = (await akossiwa.post("/v1/groups", RULES)).body.id as string;
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await akossiwa.post(`/v1/groups/${groupId}/propose`, {});
  await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await akossiwa.post(`/v1/groups/${groupId}/start`);
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (const [number, offset] of [[1, -3], [2, 2], [3, 9]] as const) {
    await prisma.round.update({
      where: { groupId_number: { groupId, number } },
      data: { dueDate: new Date(today.getTime() + offset * DAY) },
    });
  }
  const seats = await prisma.membership.findMany({ where: { groupId } });
  const ids = people.map((p) => p.member.id);
  const client = (userId: string) => [akossiwa, abla, koffi][ids.indexOf(userId)] as Client;
  const byTurn = (n: number) => seats.find((s) => s.payoutPosition === n)!.userId;
  return { groupId, akossiwa, abla, koffi, client, byTurn };
}

async function pay(member: Client, groupId: string, round: number, outcome: "PAID" | "FAILED" = "PAID") {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "TOGOCEL" });
  expect(paid.status).toBe(202);
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, outcome);
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
  return contribution;
}

describe("Mes transactions", () => {
  it("shows her contribution and her advance as two lines, with the group to open", async () => {
    const g = await startedGroup();
    await pay(g.abla, g.groupId, 1);
    const lines = (await g.abla.get("/v1/me/statement")).body.lines;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "PAID", amountFcfa: 1000, round: 1, groupId: g.groupId, groupName: "Marché de Bè" }),
        expect.objectContaining({ kind: "ADVANCE", amountFcfa: 500, round: 1 }),
      ]),
    );
  });

  it("shows a payment the operator did not confirm, sends an SMS, and lets her say the money left her account", async () => {
    const g = await startedGroup();
    outbox.length = 0;
    const attempt = await pay(g.abla, g.groupId, 1, "FAILED");
    expect(outbox.at(-1)).toMatchObject({ to: "+22890000002" });
    expect(outbox.at(-1)?.text).toContain("n'est pas confirmé");

    const failed = (await g.abla.get("/v1/me/statement")).body.lines.find((l: { kind: string }) => l.kind === "FAILED");
    expect(failed).toMatchObject({ id: attempt.id, amountFcfa: 1500, reported: false });

    const reported = await g.abla.post(`/v1/contributions/${attempt.id}/report`);
    expect(reported.status).toBe(200);
    const round = await g.abla.get(`/v1/groups/${g.groupId}/rounds/1`);
    expect(round.body).toMatchObject({ myStatus: "FAILED", myContributionId: attempt.id, myReported: true });
    const again = (await g.abla.get("/v1/me/statement")).body.lines.find((l: { kind: string }) => l.kind === "FAILED");
    expect(again.reported).toBe(true);

    // Not someone else's payment.
    expect((await g.koffi.post(`/v1/contributions/${attempt.id}/report`)).status).toBe(404);
  });

  it("drops a failed attempt once she has paid that round", async () => {
    const g = await startedGroup();
    await pay(g.abla, g.groupId, 1, "FAILED");
    await pay(g.abla, g.groupId, 1);
    const kinds = (await g.abla.get("/v1/me/statement")).body.lines.map((l: { kind: string }) => l.kind);
    expect(kinds).not.toContain("FAILED");
    expect(kinds).toContain("PAID");
  });

  it("shows a share the advances covered, with its deadline, and tells her by SMS", async () => {
    const g = await startedGroup();
    for (const c of [g.akossiwa, g.abla, g.koffi]) await pay(c, g.groupId, 1);
    const late = g.byTurn(3);
    for (const id of [g.byTurn(1), g.byTurn(2)]) await pay(g.client(id), g.groupId, 2);
    outbox.length = 0;
    const due = await prisma.round.findUniqueOrThrow({ where: { groupId_number: { groupId: g.groupId, number: 2 } } });
    await runPayouts(new Date(due.dueDate.getTime() + 12 * 60 * 60 * 1000));

    const covered = (await g.client(late).get("/v1/me/statement")).body.lines.find((l: { kind: string }) => l.kind === "COVERED");
    expect(covered).toMatchObject({ amountFcfa: 1000, round: 2, repaid: false });
    expect(covered.dueBy).toBeTruthy();
    const told = outbox.filter((m) => m.text.includes("avances du groupe ont payé"));
    expect(told).toHaveLength(1);
    expect(told[0]?.text).toContain("À rembourser avant le");
  });
});

describe("SMS cost", () => {
  it("writes French with GSM characters only, so one SMS holds 160 characters", () => {
    expect(toGsm("« Pagnes » : 5 000 FCFA, à payer. Fenêtre, leçon")).toBe('" Pagnes " : 5 000 FCFA, à payer. Fenetre, lecon');
  });

  it("sends Rwandan numbers to their own provider, stops real SMS for the month at the limit, and keeps pilot texts", async () => {
    const rwanda = new MockSmsProvider(); // stands for Pindo
    const togo = new MockSmsProvider(); // simulated, as on the pilot
    const desk = new SmsDesk({
      byPrefix: { "+250": { provider: rwanda, real: true } },
      fallback: { provider: togo, real: false },
      monthlyLimit: 2,
      keepText: true,
    });
    for (let i = 0; i < 3; i += 1) await desk.send("+250781234567", `Message ${i}`);
    await desk.send("+22890000002", "Novi : paiement reçu « Pagnes »");
    expect(rwanda.sent).toHaveLength(2); // the third is over the limit
    expect(togo.sent).toEqual([expect.objectContaining({ text: 'Novi : paiement recu " Pagnes "' })]);
    expect(await prisma.smsLog.count({ where: { real: true } })).toBe(2);
    expect(await prisma.smsLog.findFirst({ where: { real: false } })).toMatchObject({
      phone: "+22890000002",
      text: 'Novi : paiement recu " Pagnes "',
    });
  });
});

describe("SMS only when needed (D111)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends no payment receipt by SMS to a member who uses the app", async () => {
    const g = await startedGroup();
    const abla = await prisma.user.findFirstOrThrow({ where: { phone: "+22890000002" } });
    await prisma.device.updateMany({ where: { userId: abla.id }, data: { pushToken: "ExponentPushToken[abla]" } });
    outbox.length = 0;
    await pay(g.abla, g.groupId, 1);
    expect(outbox.filter((m) => m.to === "+22890000002")).toHaveLength(0);
    // Koffi has no app: he gets the receipt.
    await pay(g.koffi, g.groupId, 1);
    expect(outbox.filter((m) => m.to === "+22890000003" && m.text.includes("paiement reçu"))).toHaveLength(1);
  });

  it("accepts Rwandan numbers only on the pilot server, and says so to the app", async () => {
    const refused = await request(app).post("/v1/auth/otp").send({ phone: "+250781234567", purpose: "SIGN_UP", language: "FR" });
    expect(refused.status).toBe(400);
    expect((await request(app).get("/v1/config")).body).toMatchObject({ pilotRwanda: false });

    vi.stubEnv("PILOT_RWANDA", "true");
    expect((await request(app).get("/v1/config")).body).toMatchObject({ pilotRwanda: true });
    const accepted = await request(app).post("/v1/auth/otp").send({ phone: "+250781234567", purpose: "SIGN_UP", language: "FR" });
    expect(accepted.status).not.toBe(400);
  });

  it("shows a tester the SMS her phone would have received, only on the pilot", async () => {
    const g = await startedGroup();
    expect((await g.abla.get("/v1/me/sms")).body).toEqual({ enabled: false, messages: [] });
    vi.stubEnv("PILOT_SHOW_SMS", "true");
    await prisma.smsLog.create({ data: { phone: "+22890000002", text: "Novi : paiement recu.", real: false } });
    await prisma.smsLog.create({ data: { phone: "+22890000003", text: "Pas pour elle.", real: false } });
    const inbox = (await g.abla.get("/v1/me/sms")).body;
    expect(inbox).toMatchObject({ enabled: true, messages: [{ text: "Novi : paiement recu.", real: false }] });
    expect(inbox.messages).toHaveLength(1);
  });
});
