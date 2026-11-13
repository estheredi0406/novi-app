import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { mfi, payments, sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { listAttention, releaseRoundPayout } from "../services/consoleService.js";
import { getLoanPage } from "../services/loanService.js";
import { releasePayout, runPayouts } from "../services/payoutService.js";
import { balances, decideAccount, saveSavingsPolicy } from "../services/savingsService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, savingsTermsFor, signedUpMember } from "./helpers.js";

if (!(mfi instanceof MockMfiAdapter) || !(payments instanceof MockPaymentProvider)) {
  throw new Error("Tests require the mock MFI and payment providers.");
}
const mockMfi = mfi;
const mockPayments = payments;

// D123: a member keeps her pot, or part of it, in savings at the MFI.
const GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };
const PAST = new Date("2026-01-02T00:00:00Z");
// D126: the choice is made before the pot's day; payOutRoundOne then moves the
// day into the past to send the pot.
const SOON = () => new Date(Date.now() + 86_400_000);

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
    put: (path: string, body?: object) => auth(request(app).put(path).send(body ?? {})),
  };
}
type Member = ReturnType<typeof as>;

async function activeGroup(terms = true) {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const members = people.map((p) => as(p.tokens.accessToken));
  const groupId = (await members[0]!.post("/v1/groups", GROUP)).body.id as string;
  await prisma.mfi.updateMany({ data: { autoReleaseFcfa: null } });
  if (terms) await savingsTermsFor();
  await members[0]!.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await members[0]!.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await members[0]!.post(`/v1/groups/${groupId}/propose`);
  await members[1]!.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await members[2]!.post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await members[0]!.post(`/v1/groups/${groupId}/start`);
  const round = await prisma.round.findUniqueOrThrow({
    where: { groupId_number: { groupId, number: 1 } },
    include: { beneficiary: true, group: true },
  });
  const phones = ["+22890000001", "+22890000002", "+22890000003"];
  const receiver = members[phones.indexOf(round.beneficiary.phone)] as Member;
  return { groupId, members, round, receiver };
}

async function pay(member: Member, groupId: string, number: number) {
  const paid = await member.post(`/v1/groups/${groupId}/rounds/${number}/pay`, { operator: "TOGOCEL" });
  const contribution = await prisma.contribution.findUniqueOrThrow({ where: { id: paid.body.id } });
  const delivery = mockPayments.settle(contribution.providerRef as string, "PAID");
  await request(app)
    .post("/v1/webhooks/payments")
    .set("X-FEDAPAY-SIGNATURE", delivery.signature)
    .set("Content-Type", "application/json")
    .send(delivery.body);
}

async function officer() {
  const mfiRow = await prisma.mfi.findFirstOrThrow({ where: { code: "MAWULI" } });
  await createStaff({ mfiCode: "MAWULI", email: `o${Date.now()}@mawuli.example`, name: "Officer" });
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { mfiId: mfiRow.id } });
  return { mfiId: mfiRow.id, staffId: staff.id };
}

// Everyone pays round 1, it falls due, and the officer releases the pot.
async function payOutRoundOne(groupId: string, members: Member[]) {
  for (const m of members) await pay(m, groupId, 1);
  await prisma.round.update({ where: { groupId_number: { groupId, number: 1 } }, data: { dueDate: PAST } });
  await runPayouts();
  const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 1 } } });
  await releasePayout(payout.id, null);
  return prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
}

// D147: a complete set of conditions for saveSavingsPolicy.
const terms = (over: Record<string, unknown> = {}) => ({
  freeBp: 0,
  lock3Bp: 0,
  lock6Bp: 0,
  lock12Bp: 0,
  requireForLoan: false,
  openingFeeFcfa: 0,
  monthlyFeeFcfa: 0,
  withdrawalFeeFcfa: 0,
  minKeepFcfa: 1000,
  earlyRule: "LOSE_GAINS" as "LOSE_GAINS" | "PENALTY",
  earlyPenaltyBp: null as number | null,
  ...over,
});

const choice = (keepFcfa: number, consent = true, pocket: "FREE" | "LOCKED" = "FREE", lockMonths: 3 | 6 | 12 | null = null) => ({
  keepFcfa,
  pocket,
  lockMonths,
  consent,
});

describe("choosing where her pot goes (D123)", () => {
  it("asks her as soon as she joins, before the start, and carries her choice to her round (D147)", async () => {
    const people = [
      await signedUpMember(),
      await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
      await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
    ];
    const [org, abla, koffi] = people.map((p) => as(p.tokens.accessToken)) as [Member, Member, Member];
    const groupId = (await org.post("/v1/groups", GROUP)).body.id as string;
    await savingsTermsFor("MAWULI", { lock6Bp: 500, lock12Bp: null });
    await org.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
    await org.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
    await org.post(`/v1/groups/${groupId}/propose`);
    await abla.post(`/v1/groups/${groupId}/accept`, { version: 1 });

    const before = (await abla.get("/v1/me/savings")).body.choices;
    expect(before).toEqual([
      expect.objectContaining({ groupId, roundId: null, started: false, potFcfa: 15000, chosen: false }),
    ]);
    expect(before[0].terms).toMatchObject({ freeBp: 0, minKeepFcfa: 1000, early: { rule: "LOSE_GAINS" } });
    // Below the caisse's minimum, or a duration it does not offer: refused.
    const put = (body: object) => abla.put(`/v1/me/savings/groups/${groupId}`, body);
    expect((await put(choice(500))).status).toBe(400);
    expect((await put(choice(5000, true, "LOCKED", 12))).status).toBe(400);
    // Her account is asked for at once, weeks before her turn.
    expect((await put(choice(5000, true, "LOCKED", 6))).status).toBe(200);
    expect(await prisma.savingsAccount.count({ where: { status: "REQUESTED" } })).toBe(1);

    await koffi.post(`/v1/groups/${groupId}/accept`, { version: 1 });
    await org.post(`/v1/groups/${groupId}/start`);
    const hers = await prisma.round.findFirstOrThrow({ where: { groupId, beneficiary: { phone: "+22890000002" } } });
    expect(await prisma.potChoice.findUnique({ where: { roundId: hers.id } })).toMatchObject({
      keepFcfa: 5000,
      pocket: "LOCKED",
      lockMonths: 6,
    });
  });

  it("offers no savings while the caisse has not set its conditions (D147)", async () => {
    const { round, receiver, groupId } = await activeGroup(false);
    expect((await receiver.get("/v1/me/savings")).body.choices).toHaveLength(0);
    expect((await receiver.put(`/v1/me/savings/groups/${groupId}`, choice(5000))).body.error.code).toBe(
      "SAVINGS_TERMS_MISSING",
    );
    expect((await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(5000))).status).toBe(409);
  });

  it("keeps her choice open for every pot of hers until it leaves (D147)", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: new Date(Date.now() + 30 * 86_400_000) } });
    const { body } = await receiver.get("/v1/me/savings");
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0]).toMatchObject({ potFcfa: 15000, started: true, chosen: false, keepFcfa: 0, accountStatus: null });
  });

  it("closes the choice once the pot's day has passed, even with nothing paid (D126)", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: PAST } });
    expect((await receiver.get("/v1/me/savings")).body.choices).toHaveLength(0);
    expect((await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(0, false, "LOCKED", null))).status).toBe(409);
  });

  it("asks her agreement before an account is requested, then requests it once", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    const refused = await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000, false));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("SAVINGS_CONSENT_REQUIRED");
    const ok = await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));
    expect(ok.status).toBe(200);
    expect(ok.body.choices[0]).toMatchObject({ keepFcfa: 10000, accountStatus: "REQUESTED" });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(5000));
    expect(await prisma.savingsAccount.count()).toBe(1);
  });

  it("accepts \"all on my phone\" without a length, and any amount up to the pot", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    const phone = await receiver.put(`/v1/me/savings/choices/${round.id}`, { keepFcfa: 0, pocket: "LOCKED", lockMonths: null, consent: false });
    expect(phone.status).toBe(200);
    // D144: "all on my phone" is an answer: home stops asking.
    expect(phone.body.choices[0]).toMatchObject({ chosen: true, keepFcfa: 0, accountStatus: null });
    const odd = await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(7250, true, "LOCKED", 12));
    expect(odd.status).toBe(200);
    expect(odd.body.choices[0]).toMatchObject({ keepFcfa: 7250, lockMonths: 12 });
    const tooMuch = await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(15500, true, "LOCKED", 12));
    expect(tooMuch.status).toBe(400);
  });

  it("refuses a choice for a pot that is not hers", async () => {
    const { round, members, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    const other = members.find((m) => m !== receiver) as Member;
    expect((await other.put(`/v1/me/savings/choices/${round.id}`, choice(5000))).status).toBe(409);
  });
});

describe("sending a pot with a part kept (D123)", () => {
  it("keeps the chosen part at the MFI and sends only the rest to her wallet", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));
    const { mfiId, staffId } = await officer();
    const account = await prisma.savingsAccount.findFirstOrThrow();
    await decideAccount(mfiId, staffId, account.id, { open: true });

    const payout = await payOutRoundOne(groupId, members);
    expect(payout).toMatchObject({ status: "PAID", amountFcfa: 15000, keptFcfa: 10000 });
    expect(mockMfi.payouts.get(payout.id)).toMatchObject({ amountFcfa: 5000 });
    const { body } = await receiver.get("/v1/me/savings");
    expect(body.accounts[0]).toMatchObject({ status: "OPEN", freeFcfa: 10000, totalFcfa: 10000 });
  });

  it("sends nothing when she keeps it all, and still settles the pot", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(15000, true, "LOCKED", 6));
    const { mfiId, staffId } = await officer();
    await decideAccount(mfiId, staffId, (await prisma.savingsAccount.findFirstOrThrow()).id, { open: true });

    const before = mockMfi.payouts.size;
    const payout = await payOutRoundOne(groupId, members);
    expect(payout).toMatchObject({ status: "PAID", keptFcfa: 15000 });
    expect(mockMfi.payouts.size).toBe(before);
    const entry = await prisma.savingsEntry.findFirstOrThrow();
    expect(entry).toMatchObject({ pocket: "LOCKED", lockMonths: 6, amountFcfa: 15000 });
    const { body } = await receiver.get("/v1/me/savings");
    expect(body.accounts[0]).toMatchObject({ freeFcfa: 0, lockedFcfa: 15000 });
  });

  it("holds the pot until the MFI opens her account, then keeps her part (D141)", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));

    const waiting = await payOutRoundOne(groupId, members);
    expect(waiting.status).toBe("READY");
    expect(mockMfi.payouts.has(waiting.id)).toBe(false);
    const { mfiId, staffId } = await officer();
    const [item] = await listAttention(mfiId, staffId);
    expect(item).toMatchObject({ payoutId: waiting.id, savingsToOpenFcfa: 10000, herKeepFcfa: 10000, canRelease: false });
    // D144: home shows the same split as the console.
    const home = (await receiver.get("/v1/groups")).body.find((g: { id: string }) => g.id === groupId);
    expect(home.currentRound.myTurn).toMatchObject({ keepFcfa: 10000 });
    await expect(releaseRoundPayout(mfiId, staffId, waiting.id)).rejects.toMatchObject({ code: "SAVINGS_ACCOUNT_TO_OPEN" });

    await decideAccount(mfiId, staffId, (await prisma.savingsAccount.findFirstOrThrow()).id, { open: true });
    expect(await releasePayout(waiting.id, null)).toBe(true);
    const sent = await prisma.payout.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(sent).toMatchObject({ status: "PAID", keptFcfa: 10000 });
    expect(mockMfi.payouts.get(sent.id)).toMatchObject({ amountFcfa: 5000 });
  });

  it("tells her when her account is opened, by SMS if she has no app (D143)", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));
    const { mfiId, staffId } = await officer();
    if (!(sms instanceof MockSmsProvider)) throw new Error("Tests require the mock SMS provider.");
    const before = sms.sent.length;
    const account = await prisma.savingsAccount.findFirstOrThrow();
    await decideAccount(mfiId, staffId, account.id, { open: true });
    expect(sms.sent.slice(before)).toEqual([
      expect.objectContaining({
        to: round.beneficiary.phone,
        text: `Novi : Caisse Mawuli a ouvert votre compte d'épargne ${account.ref}. La part de votre cagnotte choisie y sera placée.`,
      }),
    ]);
  });

  it("sends the whole pot to her wallet when the MFI refuses her account (D141)", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));
    const { mfiId, staffId } = await officer();
    await decideAccount(mfiId, staffId, (await prisma.savingsAccount.findFirstOrThrow()).id, { open: false, reason: "test" });

    const payout = await payOutRoundOne(groupId, members);
    expect(payout).toMatchObject({ status: "PAID", keptFcfa: 0 });
    expect(mockMfi.payouts.get(payout.id)).toMatchObject({ amountFcfa: 15000 });
    expect(await prisma.savingsEntry.count()).toBe(0);
  });

  it("works out the kept part again after a refused transfer (D141)", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: SOON() } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));
    const { mfiId, staffId } = await officer();
    await decideAccount(mfiId, staffId, (await prisma.savingsAccount.findFirstOrThrow()).id, { open: true });
    for (const m of members) await pay(m, groupId, 1);
    await prisma.round.update({ where: { groupId_number: { groupId, number: 1 } }, data: { dueDate: PAST } });
    await runPayouts();
    const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 1 } } });
    await prisma.payout.update({ where: { id: payout.id }, data: { status: "FAILED", keptFcfa: null, attempts: 1, failedAt: PAST } });
    // She changes her mind while it waits: the next try uses the new choice.
    await prisma.potChoice.update({ where: { roundId: round.id }, data: { keepFcfa: 4000 } });
    await runPayouts();
    const sent = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(sent).toMatchObject({ status: "PAID", keptFcfa: 4000 });
  });
});

describe("withdrawing and the rules of the pockets (D123)", () => {
  async function saved(pocket: "FREE" | "LOCKED", lockMonths: 3 | 6 | 12 | null) {
    const g = await activeGroup();
    await prisma.round.update({ where: { id: g.round.id }, data: { dueDate: SOON() } });
    await g.receiver.put(`/v1/me/savings/choices/${g.round.id}`, choice(10000, true, pocket, lockMonths));
    const o = await officer();
    await decideAccount(o.mfiId, o.staffId, (await prisma.savingsAccount.findFirstOrThrow()).id, { open: true });
    await payOutRoundOne(g.groupId, g.members);
    const account = await prisma.savingsAccount.findFirstOrThrow();
    return { ...g, ...o, account };
  }

  it("sends a withdrawal of free money to her own number", async () => {
    const { receiver, account, round } = await saved("FREE", null);
    const res = await receiver.post(`/v1/me/savings/${account.id}/withdraw`, { amountFcfa: 4000 });
    expect(res.status).toBe(200);
    expect(res.body.accounts[0]).toMatchObject({ freeFcfa: 6000 });
    const entry = await prisma.savingsEntry.findFirstOrThrow({ where: { kind: "WITHDRAWAL" } });
    expect(mockMfi.payouts.get(entry.id)).toMatchObject({ amountFcfa: 4000, phone: round.beneficiary.phone });
  });

  it("does not let her take locked money before its day, nor more than she has", async () => {
    const { receiver, account } = await saved("LOCKED", 3);
    const res = await receiver.post(`/v1/me/savings/${account.id}/withdraw`, { amountFcfa: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SAVINGS_NOT_ENOUGH");
  });

  it("lets her take a whole placement back before its date, without its gains", async () => {
    const { receiver, account, mfiId, staffId, round } = await saved("LOCKED", 12);
    await saveSavingsPolicy(mfiId, staffId, terms({ lock12Bp: 800 }));
    const before = (await receiver.get("/v1/me/savings")).body.accounts[0];
    expect(before.locked).toHaveLength(1);
    const lotId = before.locked[0].id as string;
    const res = await receiver.post(`/v1/me/savings/${account.id}/placements/${lotId}/withdraw`);
    expect(res.status).toBe(200);
    expect(res.body.accounts[0]).toMatchObject({ totalFcfa: 0, lockedFcfa: 0, interestToDateFcfa: 0 });
    expect(res.body.accounts[0].entries[0]).toMatchObject({ kind: "WITHDRAWAL", early: true, amountFcfa: -10000 });
    const out = await prisma.savingsEntry.findFirstOrThrow({ where: { kind: "WITHDRAWAL" } });
    expect(mockMfi.payouts.get(out.id)).toMatchObject({ amountFcfa: 10000, phone: round.beneficiary.phone });
    expect((await receiver.post(`/v1/me/savings/${account.id}/placements/${lotId}/withdraw`)).status).toBe(404);
  });

  it("takes the caisse's penalty when she takes a placement back early (D147)", async () => {
    const { receiver, account, mfiId, staffId } = await saved("LOCKED", 12);
    await saveSavingsPolicy(mfiId, staffId, terms({ earlyRule: "PENALTY", earlyPenaltyBp: 200 }));
    const lotId = (await receiver.get("/v1/me/savings")).body.accounts[0].locked[0].id as string;
    expect((await receiver.post(`/v1/me/savings/${account.id}/placements/${lotId}/withdraw`)).status).toBe(200);
    const out = await prisma.savingsEntry.findFirstOrThrow({ where: { kind: "WITHDRAWAL" } });
    expect(mockMfi.payouts.get(out.id)).toMatchObject({ amountFcfa: 9800 }); // 10 000 less 2 %
  });

  it("frees locked money on its day, and counts interest at the rate it came in with", async () => {
    const { mfiId, staffId, account } = await saved("LOCKED", 3);
    await saveSavingsPolicy(mfiId, staffId, terms({ freeBp: 300, lock3Bp: 600 }));
    const entries = await prisma.savingsEntry.findMany({ where: { accountId: account.id } });
    const inFourMonths = new Date(Date.now() + 122 * 86_400_000);
    const b = balances(entries, inFourMonths);
    expect(b.freeFcfa).toBe(10000); // past its unlock day
    // The rate was not set when the money came in: no interest is invented.
    expect(b.interestToDateFcfa).toBe(0);
    const withRate = entries.map((e) => ({ ...e, rateBp: 600, createdAt: new Date(Date.now() - 365 * 86_400_000), unlockAt: null }));
    expect(balances(withRate, new Date()).interestToDateFcfa).toBe(600); // 6 % of 10 000 over a year
  });

  it("lets the MFI ask for savings before a loan", async () => {
    const { mfiId, staffId, round } = await saved("FREE", null);
    await saveSavingsPolicy(mfiId, staffId, terms({ requireForLoan: true }));
    const theirs = await getLoanPage(round.beneficiaryId);
    expect(theirs.checks.find((c) => c.key === "SAVINGS")).toMatchObject({ ok: true });
    const other = await prisma.user.findFirstOrThrow({ where: { id: { not: round.beneficiaryId } } });
    expect((await getLoanPage(other.id)).checks.find((c) => c.key === "SAVINGS")).toMatchObject({ ok: false });
  });
});

describe("pilot: rounds follow each other (D127)", () => {
  async function inPilot<T>(run: () => Promise<T>): Promise<T> {
    const before = process.env.PILOT_SHOW_CODES;
    process.env.PILOT_SHOW_CODES = "true";
    try {
      return await run();
    } finally {
      if (before === undefined) delete process.env.PILOT_SHOW_CODES;
      else process.env.PILOT_SHOW_CODES = before;
    }
  }
  const phones = ["+22890000001", "+22890000002", "+22890000003"];

  it("opens the choice for the whole current round, and sends the pot once all have paid", async () => {
    await inPilot(async () => {
      const { groupId, members, round, receiver } = await activeGroup();
      const later = new Date(Date.now() + 20 * 86_400_000);
      await prisma.round.update({ where: { id: round.id }, data: { dueDate: later } });
      expect((await receiver.get("/v1/me/savings")).body.choices).toHaveLength(1);

      const round2 = await prisma.round.findUniqueOrThrow({
        where: { groupId_number: { groupId, number: 2 } },
        include: { beneficiary: true },
      });
      const second = members[phones.indexOf(round2.beneficiary.phone)] as Member;
      // D147: her later pot is hers to direct from the start too.
      expect((await second.get("/v1/me/savings")).body.choices).toHaveLength(1);

      for (const m of members) await pay(m, groupId, 1);
      const payout = await prisma.payout.findFirstOrThrow({ where: { roundId: round.id } });
      expect(payout.status).not.toBe("HELD");
      expect((await prisma.round.findUniqueOrThrow({ where: { id: round.id } })).dueDate.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await second.get("/v1/me/savings")).body.choices).toHaveLength(1);
      // D137: her full pot waits for the officer, and is still hers to split.
      expect(payout.status).toBe("READY");
      const open = await receiver.get("/v1/me/savings");
      expect(open.body.choices).toHaveLength(1);
      expect((await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(5000))).status).toBe(200);
      // D141: her account must be open first; then the pot leaves with her part kept.
      expect(await releasePayout(payout.id, null)).toBe(false);
      const { mfiId, staffId } = await officer();
      await decideAccount(mfiId, staffId, (await prisma.savingsAccount.findFirstOrThrow()).id, { open: true });
      expect(await releasePayout(payout.id, null)).toBe(true);
      const sent = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(sent.keptFcfa).toBe(5000);
      expect((await receiver.get("/v1/me/savings")).body.choices).toHaveLength(0);
    });
  });

  it("keeps the calendar outside the pilot", async () => {
    const { groupId, members, round } = await activeGroup();
    const later = new Date(Date.now() + 20 * 86_400_000);
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: later } });
    for (const m of members) await pay(m, groupId, 1);
    expect(await prisma.payout.count({ where: { roundId: round.id } })).toBe(0);
  });
});
