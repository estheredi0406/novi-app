import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { payments } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D92: daily groups, home's news across groups, her statement.

if (!(payments instanceof MockPaymentProvider)) throw new Error("Tests require the mock payment provider.");
const mockPayments = payments;

const as = (token: string) => ({
  get: (path: string) => request(app).get(path).set("Authorization", `Bearer ${token}`),
  post: (path: string, body?: object) =>
    request(app)
      .post(path)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {}),
});

async function runningGroup(rules: object) {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const a = as(akossiwa.tokens.accessToken);
  const groupId = (await a.post("/v1/groups", { name: "Marché de Bè", size: 3, payoutOrder: "DRAWN", ...rules })).body
    .id as string;
  await a.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await a.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await a.post(`/v1/groups/${groupId}/propose`, { shareConsent: true });
  await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: true });
  await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1, shareConsent: true });
  const started = await a.post(`/v1/groups/${groupId}/start`);
  if (started.body.state !== "ACTIVE") throw new Error(`group did not start: ${JSON.stringify(started.body)}`);
  return { groupId, akossiwa: a, abla: as(abla.tokens.accessToken) };
}

async function pay(member: ReturnType<typeof as>, groupId: string, round = 1) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "MOOV_TG" });
  const c = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const d = mockPayments.settle(c.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", d.signature)
    .set("Content-Type", "application/json")
    .send(d.body);
}

describe("daily groups (D92)", () => {
  it("accepts a daily group, due every day but Sunday", async () => {
    const { akossiwa, groupId } = await runningGroup({ amountFcfa: 1000, frequency: "DAILY", dueDay: 1 });
    const rounds = (await akossiwa.get(`/v1/groups/${groupId}/rounds`)).body as { dueDate: string }[];
    expect(rounds).toHaveLength(3);
    for (const r of rounds) expect(new Date(`${r.dueDate}T00:00:00Z`).getUTCDay()).not.toBe(0);
    const days = rounds.map((r) => Date.parse(`${r.dueDate}T00:00:00Z`) / 86_400_000);
    expect(days[1]! - days[0]!).toBeLessThanOrEqual(2);
  });

  it("refuses a day of the week for a daily group", async () => {
    const akossiwa = as((await signedUpMember()).tokens.accessToken);
    const res = await akossiwa.post("/v1/groups", {
      name: "Marché de Bè",
      amountFcfa: 1000,
      frequency: "DAILY",
      dueDay: 5,
      size: 3,
      payoutOrder: "DRAWN",
    });
    expect(res.status).toBe(400);
  });
});

describe("home news and statement (D92)", () => {
  it("shows the receiver's name on home, payments as news, and her statement", async () => {
    const { akossiwa, abla, groupId } = await runningGroup({ amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5 });
    const home = (await akossiwa.get("/v1/groups")).body as { currentRound: { receiverName: string } }[];
    const rounds = (await akossiwa.get(`/v1/groups/${groupId}/rounds`)).body as { beneficiaryName: string }[];
    expect(home[0]?.currentRound.receiverName).toBe(rounds[0]?.beneficiaryName);
    // What she pays is the contribution, not the pot divided by the members.
    expect((rounds[0] as unknown as { amountFcfa: number }).amountFcfa).toBe(5000);

    await pay(abla, groupId);
    await pay(akossiwa, groupId);
    const news = (await akossiwa.get("/v1/me/news")).body as {
      event: string;
      who: string;
      mine: boolean;
      amountFcfa: number;
      groupName: string;
    }[];
    expect(news.map((n) => [n.event, n.who, n.mine])).toEqual([
      ["PAID", "Akossiwa", true],
      ["PAID", "Abla", false],
    ]);
    expect(news[0]?.amountFcfa).toBe(5000);
    const after = (await akossiwa.get("/v1/groups")).body as { currentRound: { paidSeats: boolean[]; paidCount: number } }[];
    expect(after[0]?.currentRound.paidSeats).toHaveLength(3);
    expect(after[0]?.currentRound.paidSeats.filter(Boolean)).toHaveLength(2);
    expect(news[0]?.groupName).toBe("Marché de Bè");

    const statement = (await akossiwa.get("/v1/me/statement")).body as {
      lines: { kind: string; amountFcfa: number; onTime: boolean; round: number }[];
    };
    expect(statement.lines).toEqual([expect.objectContaining({ kind: "PAID", amountFcfa: 5000, onTime: true, round: 1 })]);
  });

  it("is empty while she has no group, and the statement too", async () => {
    const akossiwa = as((await signedUpMember()).tokens.accessToken);
    expect((await akossiwa.get("/v1/me/news")).body).toEqual([]);
    expect((await akossiwa.get("/v1/me/statement")).body).toEqual({ lines: [] });
  });
});
