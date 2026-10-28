import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { push } from "../providers/index.js";
import { MockPushProvider } from "../providers/push/MockPushProvider.js";
import { runReminders } from "../services/reminderService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// Phone notifications (D79).

if (!(push instanceof MockPushProvider)) throw new Error("Tests require the mock push provider.");
const sent = push.sent;

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
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
    put: (path: string, body: object) => auth(request(app).put(path).send(body)),
    patch: (path: string, body: object) => auth(request(app).patch(path).send(body)),
  };
}
type Client = ReturnType<typeof as>;
const token = (name: string) => `ExponentPushToken[${name}]`;

// Akossiwa's running group; each phone has given Novi its token.
async function group() {
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
  await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await akossiwa.post(`/v1/groups/${groupId}/start`);
  for (const [client, name] of [
    [akossiwa, "akossiwa"],
    [abla, "abla"],
    [koffi, "koffi"],
  ] as const) {
    expect((await client.put("/v1/me/push-token", { token: token(name) })).status).toBe(204);
  }
  sent.length = 0;
  return { groupId, akossiwa, abla, koffi };
}

beforeEach(() => {
  sent.length = 0;
});

describe("phone notifications", () => {
  it("tells the others when a member calls the group, and opens the chat", async () => {
    const { groupId, abla } = await group();
    await abla.post(`/v1/groups/${groupId}/call`);
    expect(sent.map((m) => m.to).sort()).toEqual([token("akossiwa"), token("koffi")]);
    expect(sent[0]).toMatchObject({
      title: "Abla appelle Pagnes Assigamé",
      channelId: "calls",
      data: { url: `/groups/${groupId}?tab=discussion` },
    });
  });

  it("sends at most one chat notification an hour per member and group", async () => {
    const { groupId, akossiwa, abla } = await group();
    await abla.post(`/v1/groups/${groupId}/messages`, { body: "Je paie mardi" });
    await abla.post(`/v1/groups/${groupId}/messages`, { body: "Et vous ?" });
    expect(sent).toHaveLength(2); // Akossiwa and Koffi, once each
    expect(sent[0]).toMatchObject({ title: "Pagnes Assigamé", body: "Abla : Je paie mardi", channelId: "chat" });

    // An hour later, the next message notifies again (Abla, who wrote, has
    // since closed the chat: someone reading it now is not notified).
    const hourAgo = new Date(Date.now() - 61 * 60_000);
    await prisma.membership.updateMany({ where: { groupId }, data: { chatPushedAt: hourAgo, chatReadAt: hourAgo } });
    sent.length = 0;
    await akossiwa.post(`/v1/groups/${groupId}/messages`, { body: "Oui" });
    expect(sent.map((m) => m.to).sort()).toEqual([token("abla"), token("koffi")]);
  });

  it("respects a member who switched chat notifications off, and never reaches a logged-out phone", async () => {
    const { groupId, abla, koffi } = await group();
    expect((await koffi.patch("/v1/me", { notifyChat: false })).body.notifyChat).toBe(false);
    await prisma.session.updateMany({ where: { user: { displayName: "Akossiwa" } }, data: { revokedAt: new Date() } });
    await abla.post(`/v1/groups/${groupId}/messages`, { body: "Bonjour" });
    expect(sent).toHaveLength(0);
  });

  it("reminds a member the day before a payment, with the amount", async () => {
    const { groupId } = await group();
    const round = await prisma.round.findFirstOrThrow({ where: { groupId, number: 1 } });
    const morning = new Date(round.dueDate.getTime() - 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
    await runReminders(morning);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ title: "Cotisation de 5 000 FCFA demain", channelId: "money" });
  });

  it("refuses a token that is not Expo's", async () => {
    const { akossiwa } = await group();
    expect((await akossiwa.put("/v1/me/push-token", { token: "https://evil.example" })).status).toBe(400);
    expect((await akossiwa.put("/v1/me/push-token", { token: null })).status).toBe(204);
  });
});
