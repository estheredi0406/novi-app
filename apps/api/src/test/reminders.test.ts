import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { payments, sms } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { runReminders } from "../services/reminderService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(payments instanceof MockPaymentProvider) || !(sms instanceof MockSmsProvider)) {
  throw new Error("Tests require the mock payment and SMS providers.");
}
const mockPayments = payments;
const outbox = sms.sent;

const SMALL_GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return { post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})) };
}

// Friday 30 October 2026 is round 1's due date in these tests.
const DUE = new Date("2026-10-30T00:00:00Z");
const THURSDAY_9AM = new Date("2026-10-29T09:00:00Z");
const FRIDAY_9AM = new Date("2026-10-30T09:00:00Z");

async function groupDueFriday() {
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
  await prisma.round.update({ where: { groupId_number: { groupId, number: 1 } }, data: { dueDate: DUE } });
  outbox.length = 0;
  return { groupId, abla: as(abla.tokens.accessToken) };
}

describe("reminders before a due date (F16)", () => {
  it("texts every member who has not paid, the day before", async () => {
    await groupDueFriday();
    expect(await runReminders(THURSDAY_9AM)).toBe(3);
    expect(outbox.map((m) => m.to).sort()).toEqual(["+22890000001", "+22890000002", "+22890000003"]);
    expect(outbox[0]?.text).toContain("demain, le 30/10/2026");
  });

  it("does not text a member who already paid", async () => {
    const { groupId, abla } = await groupDueFriday();
    const paid = await abla.post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "MOOV_TG" });
    const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
    const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
    await request(app)
      .post("/v1/webhooks/payments")
      .set("X-FEDAPAY-SIGNATURE", delivery.signature)
      .set("Content-Type", "application/json")
      .send(delivery.body);
    outbox.length = 0;

    await runReminders(THURSDAY_9AM);
    expect(outbox.map((m) => m.to)).not.toContain("+22890000002");
  });

  it("sends each reminder once, however often the job runs", async () => {
    await groupDueFriday();
    await runReminders(THURSDAY_9AM);
    expect(await runReminders(new Date("2026-10-29T10:00:00Z"))).toBe(0);
    expect(outbox).toHaveLength(3);
  });

  it("sends a second reminder on the morning of the due day", async () => {
    await groupDueFriday();
    await runReminders(THURSDAY_9AM);
    expect(await runReminders(FRIDAY_9AM)).toBe(3);
    expect(outbox.at(-1)?.text).toContain("aujourd'hui");
  });

  it("never texts at night", async () => {
    await groupDueFriday();
    expect(await runReminders(new Date("2026-10-29T21:00:00Z"))).toBe(0);
    expect(await runReminders(new Date("2026-10-29T06:00:00Z"))).toBe(0);
  });
});
