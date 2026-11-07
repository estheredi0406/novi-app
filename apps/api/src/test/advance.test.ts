import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { checkCanSkip, guardTurnOne, repayDeadline, type SkipFacts } from "../lib/groupRules.js";
import { payments } from "../providers/index.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { runCoverDeadlines } from "../services/advanceService.js";
import { runPayouts } from "../services/payoutService.js";
import { reserveBalance } from "../services/reserveService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D103: an advance of half a contribution, paid with round 1, replaces the 2%
// reserve. D104: one cover order; "Je ne peux pas payer ce tour"; deadlines,
// missed turns and default; a member with no history never takes turn 1.

if (!(payments instanceof MockPaymentProvider)) throw new Error("Tests require the mock payment provider.");
const mockPayments = payments;
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

// Akossiwa (organiser), Abla and Koffi, started; today sits inside round 2:
// round 1 was due 3 days ago, round 2 is due in 2 days, round 3 in 9.
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
  await akossiwa.post(`/v1/groups/${groupId}/propose`, { shareConsent: true });
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
  const seats = await prisma.membership.findMany({ where: { groupId }, include: { user: true } });
  const byTurn = (n: number) => seats.find((s) => s.payoutPosition === n)!;
  const client = (userId: string) =>
    userId === people[0]!.member.id ? akossiwa : userId === people[1]!.member.id ? abla : koffi;
  return { groupId, akossiwa, abla, koffi, byTurn, client, seats };
}

async function pay(member: Client, groupId: string, round: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${round}/pay`, { operator: "TOGOCEL" });
  expect(paid.status).toBe(202);
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
  return contribution;
}

// Round 1 paid by everyone, so the advances hold 3 x 500 F.
async function afterRoundOne() {
  const g = await startedGroup();
  for (const c of [g.akossiwa, g.abla, g.koffi]) await pay(c, g.groupId, 1);
  return g;
}

describe("the advance, paid with round 1 (D103)", () => {
  it("adds half a contribution to round 1, keeps it out of the pot, and nothing is taken from later rounds", async () => {
    const g = await startedGroup();
    const round = await g.abla.get(`/v1/groups/${g.groupId}/rounds/1`);
    expect(round.body).toMatchObject({ amountFcfa: 1000, advanceFcfa: 500, potFcfa: 3000 });

    const first = await pay(g.abla, g.groupId, 1);
    expect(first).toMatchObject({ amountFcfa: 1500, advanceFcfa: 500 });
    await pay(g.akossiwa, g.groupId, 1);
    await pay(g.koffi, g.groupId, 1);
    expect(await reserveBalance(g.groupId)).toBe(1500);

    await runPayouts(new Date());
    const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId: g.groupId, number: 1 } } });
    expect(payout.amountFcfa).toBe(3000);

    const second = await pay(g.abla, g.groupId, 2);
    expect(second).toMatchObject({ amountFcfa: 1000, advanceFcfa: 0 });
    expect(await reserveBalance(g.groupId)).toBe(1500);
  });

  it("shows her her advance, and what the group's advances hold", async () => {
    const g = await afterRoundOne();
    const group = await g.abla.get(`/v1/groups/${g.groupId}`);
    expect(group.body.reserve).toMatchObject({
      percent: 0,
      balanceFcfa: 1500,
      advanceFcfa: 500,
      mine: { paidFcfa: 500, nowFcfa: 500, owedFcfa: 0, dueBy: null, skipsLeft: 2, defaulted: false },
    });
  });
});

describe("Je ne peux pas payer ce tour (D104)", () => {
  it("covers her share at once, so the pot of the member whose turn it is stays full", async () => {
    const g = await afterRoundOne();
    const member = g.byTurn(3); // not the one receiving round 2
    const client = g.client(member.userId);

    const before = await client.get(`/v1/groups/${g.groupId}/rounds/2`);
    expect(before.body.canSkip).toBe(true);
    const skipped = await client.post(`/v1/groups/${g.groupId}/rounds/2/skip`);
    expect(skipped.status).toBe(200);
    expect(skipped.body.amountFcfa).toBe(1000);
    // 7 days from today, since the next turn (in 9 days) is later: the next turn wins.
    expect(new Date(skipped.body.dueBy).getTime()).toBeGreaterThan(Date.now() + 8 * DAY);
    expect(await reserveBalance(g.groupId)).toBe(500);

    const after = await client.get(`/v1/groups/${g.groupId}/rounds/2`);
    expect(after.body).toMatchObject({ canSkip: false, myCover: { asked: true, repaid: false, missed: false } });
    const mine = (await client.get(`/v1/groups/${g.groupId}`)).body.reserve.mine;
    expect(mine).toMatchObject({ owedFcfa: 1000, skipsLeft: 1 });

    // The two others pay; on the due date the pot leaves complete.
    for (const seat of g.seats.filter((s) => s.userId !== member.userId)) await pay(g.client(seat.userId), g.groupId, 2);
    const due = await prisma.round.findUniqueOrThrow({ where: { groupId_number: { groupId: g.groupId, number: 2 } } });
    await runPayouts(new Date(due.dueDate.getTime() + 12 * 60 * 60 * 1000));
    const payout = await prisma.payout.findFirstOrThrow({ where: { roundId: due.id } });
    expect(payout.amountFcfa).toBe(3000);
  });

  it("is repaid when she pays the round herself, and the advances are whole again", async () => {
    const g = await afterRoundOne();
    const member = g.byTurn(3);
    const client = g.client(member.userId);
    await client.post(`/v1/groups/${g.groupId}/rounds/2/skip`);
    await pay(client, g.groupId, 2);
    expect(await reserveBalance(g.groupId)).toBe(1500);
    const round = await client.get(`/v1/groups/${g.groupId}/rounds/2`);
    expect(round.body.myCover).toMatchObject({ repaid: true });
    // Counted once in the pot: her payment, not the cover.
    for (const seat of g.seats.filter((s) => s.userId !== member.userId)) await pay(g.client(seat.userId), g.groupId, 2);
    const due = await prisma.round.findUniqueOrThrow({ where: { groupId_number: { groupId: g.groupId, number: 2 } } });
    await runPayouts(new Date(due.dueDate.getTime() + 12 * 60 * 60 * 1000));
    expect((await prisma.payout.findFirstOrThrow({ where: { roundId: due.id } })).amountFcfa).toBe(3000);
  });

  it("is refused for her own turn, for round 1, and when the advances cannot pay it", async () => {
    const g = await afterRoundOne();
    const receiver = g.client(g.byTurn(2).userId);
    expect((await receiver.post(`/v1/groups/${g.groupId}/rounds/2/skip`)).body.error.code).toBe("SKIP_OWN_TURN");
    expect((await g.abla.post(`/v1/groups/${g.groupId}/rounds/1/skip`)).body.error.code).toBe("SKIP_NOT_THIS_ROUND");

    // An advance to a member (D88) left the advances short of one share.
    await prisma.ledgerEntry.create({
      data: { groupId: g.groupId, type: "RESERVE_ADVANCE", amountFcfa: 1000 },
    });
    const other = g.client(g.byTurn(3).userId);
    expect((await other.post(`/v1/groups/${g.groupId}/rounds/2/skip`)).body.error.code).toBe("SKIP_NO_ADVANCES");
  });
});

describe("deadlines, missed turns and default (D104)", () => {
  it("counts a missed turn after the deadline, lets the organiser extend it once, and a second miss is default", async () => {
    const g = await afterRoundOne();
    const member = g.byTurn(3);
    await g.client(member.userId).post(`/v1/groups/${g.groupId}/rounds/2/skip`);
    const cover = await prisma.reserveCover.findFirstOrThrow({ where: { userId: member.userId } });

    await runCoverDeadlines(new Date(cover.dueBy!.getTime() + 1000));
    expect((await prisma.reserveCover.findUniqueOrThrow({ where: { id: cover.id } })).missedAt).not.toBeNull();

    // Only the organiser extends, and only once; it lifts the missed turn.
    const notOrganiser = member.userId === g.byTurn(1).userId ? g.abla : g.client(member.userId);
    expect((await notOrganiser.post(`/v1/groups/${g.groupId}/members/${member.userId}/extend`)).status).toBe(403);
    const extended = await g.akossiwa.post(`/v1/groups/${g.groupId}/members/${member.userId}/extend`);
    expect(extended.status).toBe(200);
    const lifted = await prisma.reserveCover.findUniqueOrThrow({ where: { id: cover.id } });
    expect(lifted.missedAt).toBeNull();
    expect(lifted.dueBy!.getTime()).toBeGreaterThan(cover.dueBy!.getTime());
    expect((await g.akossiwa.post(`/v1/groups/${g.groupId}/members/${member.userId}/extend`)).body.error.code).toBe(
      "COVER_ALREADY_EXTENDED",
    );

    // Round 3 is covered on its due date too; both deadlines pass: default.
    const round3 = await prisma.round.findUniqueOrThrow({ where: { groupId_number: { groupId: g.groupId, number: 3 } } });
    await prisma.reserveCover.create({
      data: { roundId: round3.id, userId: member.userId, amountFcfa: 1000, dueBy: new Date(Date.now() + DAY) },
    });
    await runCoverDeadlines(new Date(lifted.dueBy!.getTime() + 1000));
    const seat = await prisma.membership.findFirstOrThrow({ where: { groupId: g.groupId, userId: member.userId } });
    expect(seat.defaultedAt).not.toBeNull();
    const mine = (await g.client(member.userId).get(`/v1/groups/${g.groupId}`)).body.reserve.mine;
    expect(mine.defaulted).toBe(true);
  });
});

describe("the rules, on their own", () => {
  const base: SkipFacts = {
    roundNumber: 3,
    currentRound: 3,
    isBeneficiary: false,
    alreadyPaid: false,
    alreadyCovered: false,
    dueDatePassed: false,
    owesCover: false,
    skipsThisCycle: 0,
    skippedPreviousRound: false,
    advancesFcfa: 5000,
    amountFcfa: 1000,
  };
  const reason = (f: Partial<SkipFacts>) => {
    const r = checkCanSkip({ ...base, ...f });
    return r.ok ? "OK" : r.reason;
  };

  it("allows twice in a cycle, never two turns in a row, never while she owes, never after the due date", () => {
    expect(reason({})).toBe("OK");
    expect(reason({ skipsThisCycle: 1 })).toBe("OK");
    expect(reason({ skipsThisCycle: 2 })).toBe("SKIP_LIMIT");
    expect(reason({ skippedPreviousRound: true })).toBe("SKIP_TWICE_IN_A_ROW");
    expect(reason({ owesCover: true })).toBe("SKIP_OWES_COVER");
    expect(reason({ dueDatePassed: true })).toBe("SKIP_NOT_THIS_ROUND");
    expect(reason({ alreadyPaid: true })).toBe("ALREADY_PAID");
    expect(reason({ roundNumber: 4 })).toBe("SKIP_NOT_THIS_ROUND");
  });

  it("gives 7 days, or until the end of the next turn's day if that is later", () => {
    const covered = new Date("2026-11-04T10:00:00Z");
    // A daily group: the next turn is tomorrow, so 7 days win.
    expect(repayDeadline(covered, new Date("2026-11-05T00:00:00Z")).toISOString()).toBe("2026-11-11T10:00:00.000Z");
    // A monthly group: the next turn, a month away, wins.
    expect(repayDeadline(covered, new Date("2026-12-04T00:00:00Z")).toISOString()).toBe("2026-12-04T23:59:59.999Z");
  });

  it("gives turn 1 to a member with a history, or else to the organiser", () => {
    expect(guardTurnOne(["a", "b", "c"], new Set(["c"]), "b")).toEqual(["c", "b", "a"]);
    expect(guardTurnOne(["a", "b", "c"], new Set(), "b")).toEqual(["b", "a", "c"]);
    expect(guardTurnOne(["a", "b", "c"], new Set(["a"]), "b")).toEqual(["a", "b", "c"]);
  });

  it("refuses a fixed order that puts a member with no history first", async () => {
    const akossiwa = await signedUpMember();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
    const org = as(akossiwa.tokens.accessToken);
    const groupId = (await org.post("/v1/groups", RULES)).body.id as string;
    await org.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
    await org.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
    await org.post(`/v1/groups/${groupId}/propose`, {});
    await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
    const ordered = await org.post(`/v1/groups/${groupId}/order`, { memberIds: [abla.member.id, akossiwa.member.id, koffi.member.id] });
    const version = ordered.body.rules?.version ?? 2;
    await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version });
    await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version });
    const started = await org.post(`/v1/groups/${groupId}/start`);
    expect(started.body.error?.code).toBe("TURN_ONE_NEEDS_HISTORY");
  });
});
