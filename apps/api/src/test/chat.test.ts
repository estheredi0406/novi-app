import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { payments } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { releasePayout, runPayouts } from "../services/payoutService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// The group's chat (D70).

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

// Akossiwa's group: Abla accepted, Koffi only invited, unless started.
async function group(start = true) {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const [akossiwa, abla, koffi] = people.map((p) => as(p.tokens.accessToken)) as [Client, Client, Client];
  const groupId = (await akossiwa.post("/v1/groups", SMALL_GROUP)).body.id as string;
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await akossiwa.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await akossiwa.post(`/v1/groups/${groupId}/propose`);
  await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  if (start) {
    await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await akossiwa.post(`/v1/groups/${groupId}/start`);
  }
  return { groupId, akossiwa, abla, koffi, ids: people.map((p) => p.member.id) };
}

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

describe("the group's chat", () => {
  it("lets the members write and read, oldest first, with their display names", async () => {
    const { groupId, akossiwa, abla } = await group();
    expect((await akossiwa.post(`/v1/groups/${groupId}/messages`, { body: "Bonjour à toutes !" })).status).toBe(201);
    await abla.post(`/v1/groups/${groupId}/messages`, { body: "  Bonjour, je paie vendredi.  " });

    const page = (await abla.get(`/v1/groups/${groupId}/messages`)).body;
    expect(page.canWrite).toBe(true);
    expect(page.messages.map((m: { authorName: string; body: string; mine: boolean }) => [m.authorName, m.body, m.mine]))
      .toEqual([
        ["Akossiwa", "Bonjour à toutes !", false],
        ["Abla", "Bonjour, je paie vendredi.", true],
      ]);
  });

  it("is open to a member who asked for a change to the rules, to discuss it", async () => {
    const { groupId, koffi } = await group(false);
    await koffi.post(`/v1/groups/${groupId}/counter`, { version: 1, note: "Plutôt 3 000 FCFA ?" });
    expect((await koffi.post(`/v1/groups/${groupId}/messages`, { body: "Qu'en pensez-vous ?" })).status).toBe(201);
  });

  it("is closed to an invited number that has not answered yet (D38)", async () => {
    const { groupId, koffi } = await group(false);
    expect((await koffi.get(`/v1/groups/${groupId}/messages`)).status).toBe(404);
  });

  it("is closed to anyone outside the group", async () => {
    const { groupId } = await group();
    const ama = { niu: "TEST-0005", legalName: "Ama Essi Lawson", dateOfBirth: "1992-11-19" };
    const stranger = as((await signedUpMember("+22890000005", undefined, ama, "Ama")).tokens.accessToken);
    expect((await stranger.get(`/v1/groups/${groupId}/messages`)).status).toBe(404);
    expect((await stranger.post(`/v1/groups/${groupId}/messages`, { body: "Bonjour" })).status).toBe(404);
  });

  it("refuses empty or overlong messages, and more than 10 a minute", async () => {
    const { groupId, abla } = await group();
    expect((await abla.post(`/v1/groups/${groupId}/messages`, { body: "   " })).status).toBe(400);
    expect((await abla.post(`/v1/groups/${groupId}/messages`, { body: "x".repeat(501) })).status).toBe(400);
    for (let i = 0; i < 10; i++) await abla.post(`/v1/groups/${groupId}/messages`, { body: `message ${i}` });
    const eleventh = await abla.post(`/v1/groups/${groupId}/messages`, { body: "encore" });
    expect(eleventh.status).toBe(429);
  });

  it("returns only the new lines after the last one she has", async () => {
    const { groupId, akossiwa, abla } = await group();
    const first = (await akossiwa.post(`/v1/groups/${groupId}/messages`, { body: "un" })).body;
    await new Promise((r) => setTimeout(r, 5));
    await abla.post(`/v1/groups/${groupId}/messages`, { body: "deux" });
    const after = (await akossiwa.get(`/v1/groups/${groupId}/messages?after=${first.id}`)).body;
    expect(after.messages.map((m: { body: string }) => m.body)).toEqual(["deux"]);
  });

  it("counts unread messages on her groups until she opens the chat", async () => {
    const { groupId, akossiwa, abla } = await group();
    await akossiwa.post(`/v1/groups/${groupId}/messages`, { body: "Rappel : vendredi !" });
    await akossiwa.post(`/v1/groups/${groupId}/messages`, { body: "Merci" });
    const unread = async (member: Client) =>
      (await member.get("/v1/groups")).body.find((g: { id: string }) => g.id === groupId).unreadMessages;
    expect(await unread(abla)).toBe(2);
    expect(await unread(akossiwa)).toBe(0); // her own messages are not news to her
    await abla.get(`/v1/groups/${groupId}/messages`);
    expect(await unread(abla)).toBe(0);
  });

  it("lets the author or the organiser hide a message, which stays as a hidden line", async () => {
    const { groupId, akossiwa, abla, koffi } = await group();
    const rude = (await koffi.post(`/v1/groups/${groupId}/messages`, { body: "Envoyez-moi votre code" })).body;
    expect((await abla.post(`/v1/groups/${groupId}/messages/${rude.id}/hide`)).status).toBe(409);
    const hidden = await akossiwa.post(`/v1/groups/${groupId}/messages/${rude.id}/hide`);
    expect(hidden.status).toBe(200);
    const line = (await abla.get(`/v1/groups/${groupId}/messages`)).body.messages[0];
    expect(line).toMatchObject({ hidden: true, body: null, authorName: "Koffi" });
    expect(await prisma.auditEvent.count({ where: { type: "CHAT_MESSAGE_HIDDEN" } })).toBe(1);
  });

  it("shows when a member paid and when a pot was paid out", async () => {
    const { groupId, akossiwa, abla, koffi, ids } = await group();
    for (const member of [akossiwa, abla, koffi]) await pay(member, groupId, 1);
    await prisma.round.update({
      where: { groupId_number: { groupId, number: 1 } },
      data: { dueDate: new Date("2026-01-02T00:00:00Z") },
    });
    await runPayouts();
    const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 1 } } });
    await releasePayout(payout.id, null);

    const events = (await abla.get(`/v1/groups/${groupId}/messages`)).body.messages.filter(
      (m: { kind: string }) => m.kind === "EVENT",
    );
    expect(events.filter((e: { event: string }) => e.event === "PAID")).toHaveLength(3);
    const pot = events.find((e: { event: string }) => e.event === "POT_PAID");
    expect(pot).toMatchObject({ round: 1, authorId: payout.beneficiaryId, canHide: false });
    expect(ids).toContain(pot.authorId);
  });

  it("becomes read-only for a member who left the group (D69)", async () => {
    const { groupId, abla, ids } = await group();
    await prisma.membership.updateMany({
      where: { groupId, userId: ids[1] },
      data: { exitReason: "LEFT", exitedAt: new Date() },
    });
    expect((await abla.get(`/v1/groups/${groupId}/messages`)).body.canWrite).toBe(false);
    expect((await abla.post(`/v1/groups/${groupId}/messages`, { body: "Bonjour" })).status).toBe(409);
  });
});
