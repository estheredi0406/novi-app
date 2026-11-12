import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { mfi, payments } from "../providers/index.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { getLoanPage } from "../services/loanService.js";
import { releasePayout, runPayouts } from "../services/payoutService.js";
import { balances, decideAccount, saveSavingsPolicy } from "../services/savingsService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

if (!(mfi instanceof MockMfiAdapter) || !(payments instanceof MockPaymentProvider)) {
  throw new Error("Tests require the mock MFI and payment providers.");
}
const mockMfi = mfi;
const mockPayments = payments;

// D123: a member keeps her pot, or part of it, in savings at the MFI.
const GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };
const PAST = new Date("2026-01-02T00:00:00Z");

function as(accessToken: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
    put: (path: string, body?: object) => auth(request(app).put(path).send(body ?? {})),
  };
}
type Member = ReturnType<typeof as>;

async function activeGroup() {
  const people = [
    await signedUpMember(),
    await signedUpMember("+22890000002", undefined, ABLA, "Abla"),
    await signedUpMember("+22890000003", undefined, KOFFI, "Koffi"),
  ];
  const members = people.map((p) => as(p.tokens.accessToken));
  const groupId = (await members[0]!.post("/v1/groups", GROUP)).body.id as string;
  await prisma.mfi.updateMany({ data: { autoReleaseFcfa: null } });
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

const choice = (keepFcfa: number, consent = true, pocket: "FREE" | "LOCKED" = "FREE", lockMonths: 3 | 6 | 12 | null = null) => ({
  keepFcfa,
  pocket,
  lockMonths,
  consent,
});

describe("choosing where her pot goes (D123)", () => {
  it("opens the choice three days before her pot, not earlier", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: new Date(Date.now() + 10 * 86_400_000) } });
    expect((await receiver.get("/v1/me/savings")).body.choices).toHaveLength(0);
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: new Date(Date.now() + 2 * 86_400_000) } });
    const { body } = await receiver.get("/v1/me/savings");
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0]).toMatchObject({ potFcfa: 15000, keepFcfa: 0, accountStatus: null });
  });

  it("asks her agreement before an account is requested, then requests it once", async () => {
    const { round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: PAST } });
    const refused = await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000, false));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("SAVINGS_CONSENT_REQUIRED");
    const ok = await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));
    expect(ok.status).toBe(200);
    expect(ok.body.choices[0]).toMatchObject({ keepFcfa: 10000, accountStatus: "REQUESTED" });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(5000));
    expect(await prisma.savingsAccount.count()).toBe(1);
  });

  it("refuses a choice for a pot that is not hers", async () => {
    const { round, members, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: PAST } });
    const other = members.find((m) => m !== receiver) as Member;
    expect((await other.put(`/v1/me/savings/choices/${round.id}`, choice(5000))).status).toBe(409);
  });
});

describe("sending a pot with a part kept (D123)", () => {
  it("keeps the chosen part at the MFI and sends only the rest to her wallet", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: PAST } });
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
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: PAST } });
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

  it("sends the whole pot to her wallet when the MFI has not opened her account yet", async () => {
    const { groupId, members, round, receiver } = await activeGroup();
    await prisma.round.update({ where: { id: round.id }, data: { dueDate: PAST } });
    await receiver.put(`/v1/me/savings/choices/${round.id}`, choice(10000));

    const payout = await payOutRoundOne(groupId, members);
    expect(payout.keptFcfa).toBe(0);
    expect(mockMfi.payouts.get(payout.id)).toMatchObject({ amountFcfa: 15000 });
    expect(await prisma.savingsEntry.count()).toBe(0);
  });
});

describe("withdrawing and the rules of the pockets (D123)", () => {
  async function saved(pocket: "FREE" | "LOCKED", lockMonths: 3 | 6 | 12 | null) {
    const g = await activeGroup();
    await prisma.round.update({ where: { id: g.round.id }, data: { dueDate: PAST } });
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
    await saveSavingsPolicy(mfiId, staffId, { freeBp: null, lock3Bp: null, lock6Bp: null, lock12Bp: 800, requireForLoan: false });
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

  it("frees locked money on its day, and counts interest at the rate it came in with", async () => {
    const { mfiId, staffId, account } = await saved("LOCKED", 3);
    await saveSavingsPolicy(mfiId, staffId, { freeBp: 300, lock3Bp: 600, lock6Bp: null, lock12Bp: null, requireForLoan: false });
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
    await saveSavingsPolicy(mfiId, staffId, { freeBp: null, lock3Bp: null, lock6Bp: null, lock12Bp: null, requireForLoan: true });
    const theirs = await getLoanPage(round.beneficiaryId);
    expect(theirs.checks.find((c) => c.key === "SAVINGS")).toMatchObject({ ok: true });
    const other = await prisma.user.findFirstOrThrow({ where: { id: { not: round.beneficiaryId } } });
    expect((await getLoanPage(other.id)).checks.find((c) => c.key === "SAVINGS")).toMatchObject({ ok: false });
  });
});
