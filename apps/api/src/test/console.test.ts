import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { base32Decode, codeForStep, totpStep } from "../lib/totp.js";
import { mfi, payments } from "../providers/index.js";
import { MockMfiAdapter } from "../providers/mfi/MockMfiAdapter.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import { releasePayout, runPayouts } from "../services/payoutService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, savingsTermsFor, signedUpMember } from "./helpers.js";

if (
  !(mfi instanceof MockMfiAdapter) ||
  !(payments instanceof MockPaymentProvider)
) {
  throw new Error("Tests require the mock MFI and payment providers.");
}
const mockMfi = mfi;
const mockPayments = payments;

const SMALL_GROUP = {
  name: "Pagnes Assigamé",
  amountFcfa: 5000,
  frequency: "WEEKLY",
  dueDay: 5,
  size: 3,
  payoutOrder: "DRAWN",
};
const PAST = new Date("2026-01-02T00:00:00Z");

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

// Akossiwa's started group of three, held at Caisse Mawuli.
async function activeGroup() {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const organiser = as(akossiwa.tokens.accessToken);
  const groupId = (await organiser.post("/v1/groups", SMALL_GROUP)).body
    .id as string;
  // These tests check the officer's release (D63): an MFI that turned
  // automatic release off, so one officer releases every pot (D105).
  await prisma.mfi.updateMany({ data: { autoReleaseFcfa: null } });
  await organiser.post(`/v1/groups/${groupId}/invites`, {
    phone: "+22890000002",
  });
  await organiser.post(`/v1/groups/${groupId}/invites`, {
    phone: "+22890000003",
  });
  await organiser.post(`/v1/groups/${groupId}/propose`);
  await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, {
    version: 1,
  });
  await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, {
    version: 1,
  });
  await organiser.post(`/v1/groups/${groupId}/start`);
  return {
    groupId,
    members: [
      organiser,
      as(abla.tokens.accessToken),
      as(koffi.tokens.accessToken),
    ],
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

const makeDue = (groupId: string, number: number) =>
  prisma.round.update({
    where: { groupId_number: { groupId, number } },
    data: { dueDate: PAST },
  });

// A logged-in officer of the given MFI.
async function officer(
  mfiCode = "MAWULI",
  email = "mawuli@mawuli.example",
  role: "OFFICER" | "ADMIN" | "COMPLIANCE" = "OFFICER",
) {
  await prisma.mfi.upsert({
    where: { code: mfiCode },
    create: { code: mfiCode, name: `${mfiCode} test` },
    update: {},
  });
  const { password, totpSecret } = await createStaff({
    mfiCode,
    email,
    name: "Mawuli Adzo",
    role,
  });
  // Past his first login: his own password is set (D81).
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

describe("the console's view of groups", () => {
  it("shows the officer's groups with totals and the balance the account should hold", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const ready = await prisma.payout.findFirstOrThrow({
      where: { round: { groupId, number: 1 } },
    });
    await releasePayout(ready.id, null); // the officer's release (D63)
    await pay(members[0] as Client, groupId, 2);

    const groups = (await (await officer()).get("/v1/console/groups")).body;
    expect(groups).toEqual([
      expect.objectContaining({
        id: groupId,
        state: "ACTIVE",
        amountFcfa: 5000,
        size: 3,
        collectedFcfa: 27500, // 3 x 7 500 for round 1 (5 000 and the 2 500 advance, D103), then 5 000
        paidOutFcfa: 15000, // round 1's pot, 3 x 5 000
        balanceFcfa: 12500, // 27 500 in, 15 000 out; it holds the 7 500 of advances
        reserveFcfa: 7500,
      }),
    ]);
  });

  it("shows each round's totals and payout, never who paid", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[1] as Client, groupId, 1);

    const res = await (await officer()).get(`/v1/console/groups/${groupId}`);
    expect(res.status).toBe(200);
    expect(res.body.roundList[0]).toMatchObject({
      number: 1,
      expectedFcfa: 15000,
      collectedFcfa: 5000,
      paymentsReceived: 1,
      paymentsExpected: 3,
    });
    const text = JSON.stringify(res.body);
    for (const name of ["Akossiwa", "Abla", "Koffi", "+2289000000"])
      expect(text).not.toContain(name);
  });

  it("hides another MFI's groups, as if they did not exist", async () => {
    const { groupId } = await activeGroup();
    const other = await officer("DZIDZO", "officer@dzidzo.example");

    expect((await other.get("/v1/console/groups")).body).toEqual([]);
    expect((await other.get(`/v1/console/groups/${groupId}`)).status).toBe(404);
  });

  it("refuses members", async () => {
    const member = await signedUpMember();
    const res = await as(member.tokens.accessToken).get("/v1/console/groups");
    expect(res.status).toBe(401);
  });
});

describe("payouts that need a look (D53)", () => {
  it("lists a held pot with how many payments are missing, but not who", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await pay(members[1] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    const items = (await (await officer()).get("/v1/console/attention")).body;
    expect(items).toEqual([
      expect.objectContaining({
        groupId,
        roundNumber: 1,
        status: "HELD",
        amountFcfa: 10000, // two payments, without their advances (D103)
        paymentsMissing: 1,
        canRetry: false,
        canRelease: false,
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain("Koffi");
  });

  it("gives the officer no way to send a held pot short", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [held] = (await desk.get("/v1/console/attention")).body;

    const res = await desk.post(`/v1/console/payouts/${held.payoutId}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_ALLOWED_NOW");
  });

  it("lets the officer retry a failed transfer, which then reaches the member", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    mockMfi.nextPayout = "FAILED";
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);
    const [failed] = (await desk.get("/v1/console/attention")).body;
    expect(failed).toMatchObject({ status: "FAILED", canRetry: true });

    const res = await desk.post(`/v1/console/payouts/${failed.payoutId}/retry`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const round = await members[0]?.get(`/v1/groups/${groupId}/rounds/1`);
    expect(round?.body.payoutStatus).toBe("PAID");
    expect(
      await prisma.auditEvent.count({ where: { type: "STAFF_PAYOUT_RETRY" } }),
    ).toBe(1);
  });

  it("says why a transfer failed: the account, the transfer itself, or no answer (D154)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    const send = vi.spyOn(mockMfi, "sendPayout").mockRejectedValueOnce(
      new Error('FedaPay POST /payouts answered 403: {"message":"Opération non autorisée"}'),
    );
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);
    expect((await desk.get("/v1/console/attention")).body[0]).toMatchObject({ status: "FAILED", failReason: "ACCOUNT" });

    send.mockRejectedValueOnce(new Error("fetch failed"));
    await desk.post(`/v1/console/payouts/${ready.payoutId}/retry`);
    expect((await desk.get("/v1/console/attention")).body[0]).toMatchObject({ failReason: "NO_ANSWER" });

    mockMfi.nextPayout = "FAILED";
    await desk.post(`/v1/console/payouts/${ready.payoutId}/retry`);
    expect((await desk.get("/v1/console/attention")).body[0]).toMatchObject({ failReason: "REFUSED" });
    send.mockRestore();
  });

  it("lists a full, due pot as ready, and sends it only when the officer releases it (D63)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    expect(ready).toMatchObject({
      groupId,
      status: "READY",
      canRelease: true,
      receiverTurn: 1,
      amountFcfa: 15000,
    });
    expect(JSON.stringify(ready)).not.toMatch(/Akossiwa|Abla|Koffi/);

    const res = await desk.post(
      `/v1/console/payouts/${ready.payoutId}/release`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const round = await members[0]?.get(`/v1/groups/${groupId}/rounds/1`);
    expect(round?.body.payoutStatus).toBe("PAID");
    expect(
      await prisma.auditEvent.count({
        where: { type: "STAFF_PAYOUT_RELEASED" },
      }),
    ).toBe(1);
    expect(
      (await desk.post(`/v1/console/payouts/${ready.payoutId}/release`)).status,
    ).toBe(409);
  });

  it("shows the officer a pot its member says she did not receive (D63)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);

    const payout = await prisma.payout.findUniqueOrThrow({
      where: { id: ready.payoutId },
    });
    const receiver = (
      await Promise.all(
        members.map(async (m) => ({ m, me: (await m.get("/v1/me")).body.id })),
      )
    ).find((x) => x.me === payout.beneficiaryId);
    await receiver?.m.post(`/v1/me/payouts/${payout.id}/receipt`, {
      received: false,
    });

    const [disputed] = (await desk.get("/v1/console/attention")).body;
    expect(disputed).toMatchObject({
      payoutId: payout.id,
      status: "DISPUTED",
      canRelease: false,
      canRetry: false,
    });
    // D92: "since" is when she said it had not arrived.
    const answered = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(disputed.since).toBe(answered.receiptDisputedAt?.toISOString());
  });

  it("sums it all up on the overview", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();

    const desk = await officer();
    const overview = (await desk.get("/v1/console/overview")).body;
    expect(overview).toEqual({
      mfiName: "Caisse Mawuli",
      activeGroups: 1,
      completedGroups: 0,
      balanceFcfa: 7500, // one payment of 5 000 and its 2 500 advance
      held: 1,
      failed: 0,
      ready: 0,
      disputed: 0,
      reported: 0,
      autoReleaseFcfa: null,
      autoReleaseChosen: false, // D134: the MFI has not chosen its ceiling
      savingsTermsComplete: false, // D147: nor its savings conditions
    });
    // D92: a held pot has not left, so the ring shows no pot paid out yet,
    // and the group is flagged for a look.
    const [group] = (await desk.get("/v1/console/groups")).body;
    expect(group).toMatchObject({ potsPaid: 0, needsAttention: 1 });
  });
});

describe("validating a group before its account opens (D66)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps a started group waiting until the officer approves it", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    const { groupId, members } = await activeGroup();
    expect((await members[0]?.get(`/v1/groups/${groupId}`))?.body.state).toBe(
      "STARTING",
    );

    const desk = await officer();
    const listed = (await desk.get("/v1/console/groups")).body;
    expect(listed).toEqual([
      expect.objectContaining({ id: groupId, state: "STARTING" }),
    ]);

    // D147: not before the caisse has set its savings conditions.
    const refused = await desk.post(`/v1/console/groups/${groupId}/approve`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("SAVINGS_TERMS_MISSING");
    await savingsTermsFor();
    expect(
      (await desk.post(`/v1/console/groups/${groupId}/approve`)).status,
    ).toBe(200);
    expect((await members[0]?.get(`/v1/groups/${groupId}`))?.body.state).toBe(
      "ACTIVE",
    );
    expect(await prisma.round.count({ where: { groupId } })).toBe(3);
    expect(
      await prisma.auditEvent.count({
        where: { type: "STAFF_GROUP_APPROVED" },
      }),
    ).toBe(1);
    expect(
      (await desk.post(`/v1/console/groups/${groupId}/approve`)).status,
    ).toBe(409);
  });

  it("shows the officer each member's record, only for those who agreed (D84)", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    const akossiwa = await signedUpMember();
    const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
    const koffi = await signedUpMember(
      "+22890000003",
      undefined,
      KOFFI,
      "Koffi",
    );
    const organiser = as(akossiwa.tokens.accessToken);
    const groupId = (await organiser.post("/v1/groups", SMALL_GROUP)).body
      .id as string;
    await organiser.post(`/v1/groups/${groupId}/invites`, {
      phone: "+22890000002",
    });
    await organiser.post(`/v1/groups/${groupId}/invites`, {
      phone: "+22890000003",
    });
    expect(
      (
        await organiser.post(`/v1/groups/${groupId}/propose`, {
          shareConsent: true,
        })
      ).status,
    ).toBe(200);
    await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, {
      version: 1,
      shareConsent: true,
    });
    await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, {
      version: 1,
    }); // an older app
    await organiser.post(`/v1/groups/${groupId}/start`);

    const desk = await officer();
    const { members } = (await desk.get(`/v1/console/groups/${groupId}`)).body;
    expect(members).toHaveLength(3);
    const shared = members.filter((m: { consent: boolean }) => m.consent);
    expect(shared).toHaveLength(2);
    expect(shared[0]).toMatchObject({
      name: expect.any(String),
      verifiedAt: expect.any(String),
      cyclesCompleted: 0,
      paymentsMade: 0,
      owesCaisseFcfa: 0,
    });
    expect(members.find((m: { consent: boolean }) => !m.consent)).toMatchObject(
      { name: null, verifiedAt: null },
    );
  });

  it("lets the officer decline it with a reason, before any money moves", async () => {
    vi.stubEnv("MFI_GROUP_APPROVAL", "true");
    const { groupId, members } = await activeGroup();
    const desk = await officer();

    expect(
      (
        await desk.post(`/v1/console/groups/${groupId}/decline`, {
          reason: "Pièces manquantes",
        })
      ).status,
    ).toBe(200);
    expect((await members[0]?.get(`/v1/groups/${groupId}`))?.body.state).toBe(
      "CANCELLED",
    );
    expect(await prisma.round.count({ where: { groupId } })).toBe(0);
  });
});

describe("analytics and the officers' log (D67)", () => {
  it("counts this week's money, on-time payments and members, without names", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);

    const analytics = (await (await officer()).get("/v1/console/analytics"))
      .body;
    expect(analytics.weeks).toHaveLength(8);
    expect(analytics.weeks.at(-1)).toMatchObject({
      collectedFcfa: 22500, // 3 x (5 000 + 2 500 advance)
      paidOutFcfa: 0,
      payments: 3,
      onTime: 3,
    });
    expect(analytics).toMatchObject({
      members: 3,
      onTimeRate: 100,
      groups: { active: 1 },
    });
    expect(JSON.stringify(analytics)).not.toMatch(/Akossiwa|Abla|Koffi/);
  });

  it("shows which officer released a pot, and when", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);

    const log = (await desk.get("/v1/console/activity")).body;
    // D92: the line names the group, the round and the amount, in the
    // officer's language (the console words it), never an English fragment.
    expect(log[0]).toMatchObject({
      action: "STAFF_PAYOUT_RELEASED",
      category: "MONEY",
      staffName: expect.any(String),
      subject: expect.any(String),
      round: 1,
      amountFcfa: ready.amountFcfa,
      detail: null,
    });
  });
});

describe("bringing a due date forward, in the pilot only (D82)", () => {
  it("makes the next round due today, and logs it", async () => {
    vi.stubEnv("PILOT_SHOW_CODES", "true");
    const { groupId, members } = await activeGroup();
    // D127: two of three paid, so round 1 has not left by itself.
    await pay(members[0] as Client, groupId, 1);
    await pay(members[1] as Client, groupId, 1);
    const mawuli = await officer();
    expect((await mawuli.get("/v1/staff/me")).body.pilot).toBe(true);

    const res = await mawuli.post(`/v1/console/groups/${groupId}/demo-due`);
    expect(res.body).toEqual({ round: 1 });
    expect(await prisma.payout.count({ where: { round: { groupId, number: 1 } } })).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { type: "STAFF_DEMO_DUE" } }),
    ).toBe(1);
    vi.unstubAllEnvs();
  });

  it("can run a whole cycle in one session: a paid round leaves at once and the next opens (D127)", async () => {
    vi.stubEnv("PILOT_SHOW_CODES", "true");
    const { groupId, members } = await activeGroup();
    const mawuli = await officer();
    for (const member of members) await pay(member, groupId, 1);
    // No button needed: the last payment made round 1 due, and its pot is ready.
    const first = await prisma.payout.findFirstOrThrow({
      where: { round: { groupId, number: 1 } },
    });
    expect(first.status).toBe("READY");
    expect(
      await prisma.auditEvent.count({ where: { type: "PILOT_ROUND_FAST_FORWARD" } }),
    ).toBe(1);
    await mawuli.post(`/v1/console/payouts/${first.id}/release`);

    // Round 2 is now the one open: members can pay it straight away.
    const paid = await (members[0] as Client).post(
      `/v1/groups/${groupId}/rounds/2/pay`,
      { operator: "TOGOCEL" },
    );
    expect(paid.status).toBe(202); // the payment request is accepted, awaiting her approval
    vi.unstubAllEnvs();
  });

  it("does not exist outside the pilot", async () => {
    vi.stubEnv("PILOT_SHOW_CODES", "false");
    const { groupId } = await activeGroup();
    const res = await (
      await officer()
    ).post(`/v1/console/groups/${groupId}/demo-due`);
    expect(res.status).toBe(404);
    vi.unstubAllEnvs();
  });
});

// D113: the MFI's banking system, simulated: one account per group, booked
// from the same events as Novi's ledger, shown beside it in the console.
describe("the group accounts at the MFI (D113)", () => {
  it("credits each payment and debits each pot, with a running balance", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const ready = await prisma.payout.findFirstOrThrow({ where: { round: { groupId, number: 1 } } });
    await releasePayout(ready.id, null);

    const statement = (await (await officer()).get(`/v1/console/groups/${groupId}/account`)).body;
    expect(statement.ref).toMatch(/^GRP-/);
    expect(statement.balanceFcfa).toBe(7500); // 3 x 7 500 in, the 15 000 pot out
    const lines = [...statement.entries].reverse(); // oldest first
    expect(lines.map((e: { amountFcfa: number }) => e.amountFcfa)).toEqual([7500, 7500, 7500, -15000]);
    expect(lines.map((e: { balanceAfterFcfa: number }) => e.balanceAfterFcfa)).toEqual([7500, 15000, 22500, 7500]);
    expect(lines[0].label).toContain("Cotisation tour 1 · Mixx by Yas · dont avance 2 500 F");
    expect(lines[3].label).toContain("Cagnotte tour 1");
  });

  it("books each movement once, however often it syncs", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    const { syncCoreBanking } = await import("../services/coreBanking.js");
    await Promise.all([syncCoreBanking(), syncCoreBanking(), syncCoreBanking()]);
    expect(await prisma.bankEntry.count()).toBe(1);
    expect((await prisma.bankAccount.findFirstOrThrow()).balanceFcfa).toBe(7500);
  });

  it("shows Novi's figure and the MFI's side by side, and they agree", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    const accounts = (await (await officer()).get("/v1/console/accounts")).body;
    expect(accounts).toMatchObject({ noviFcfa: 22500, bankFcfa: 22500, bankAccounts: 1, inTransitFcfa: 0 });
  });

  it("never shows another MFI's group account", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    const other = await officer("DZIDZO", "officer@dzidzo.example");
    expect((await other.get(`/v1/console/groups/${groupId}/account`)).status).toBe(404);
    expect((await other.get("/v1/console/accounts")).body).toMatchObject({ bankFcfa: 0, bankAccounts: 0 });
  });
});

// D116: the group's colour and today's figures, for "Aujourd'hui" and "Groupes".
describe("how each group is doing, and today (D116)", () => {
  it("shows a running group with nothing open as green, with its next pot and on-time rate", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    const [g] = (await (await officer()).get("/v1/console/groups")).body;
    expect(g).toMatchObject({ id: groupId, health: "GREEN", watch: null });
    expect(g.nextPotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("turns amber while a due pot is held, not full", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[0] as Client, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const [g] = (await (await officer()).get("/v1/console/groups")).body;
    expect(g).toMatchObject({ health: "AMBER", watch: { reason: "HELD", count: 1 } });
    // Round 1 was due and only one of three paid it, on time or not.
    expect(g.onTimePct).toBeLessThanOrEqual(34);
  });

  it("turns red when a pot is refused after its automatic tries, and amber while Novi still retries", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const desk = await officer();
    const [ready] = (await desk.get("/v1/console/attention")).body;
    mockMfi.nextPayout = "FAILED";
    await desk.post(`/v1/console/payouts/${ready.payoutId}/release`);
    expect((await desk.get("/v1/console/groups")).body[0]).toMatchObject({ health: "AMBER", watch: { reason: "RETRYING" } });

    await prisma.payout.update({ where: { id: ready.payoutId }, data: { attempts: 4 } });
    expect((await desk.get("/v1/console/groups")).body[0]).toMatchObject({
      health: "RED",
      watch: { reason: "TRANSFER_FAILED", count: 1 },
    });
  });

  it("counts today's money in and out, and what left on its own", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await prisma.mfi.updateMany({ data: { autoReleaseFcfa: 50000 } });
    await makeDue(groupId, 1);
    await runPayouts();
    const today = (await (await officer()).get("/v1/console/today")).body;
    expect(today).toMatchObject({
      receivedFcfa: 22500,
      payments: 3,
      potsSent: 1,
      potsSentFcfa: 15000,
      potsDueLeft: 0,
      activeGroups: 1,
      activeMembers: 3,
      toValidate: 0,
      tontinesFcfa: 7500,
      advancesFcfa: 7500,
      // D150: the MFI's books follow Novi's ledger.
      booksGapFcfa: 0,
      auto: { potsAutoReleased: 1, lateConfirmed: 0 },
    });
  });

  it("dates each line of a group's account by when the money moved, and says a pot was simulated (D150)", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await prisma.mfi.updateMany({ data: { autoReleaseFcfa: 50000 } });
    await makeDue(groupId, 1);
    await runPayouts();
    const paidAt = (await prisma.contribution.findFirstOrThrow({ where: { round: { groupId } } })).paidAt as Date;
    const account = (await (await officer()).get(`/v1/console/groups/${groupId}/account`)).body;
    const pot = account.entries.find((e: { label: string }) => e.label.startsWith("Cagnotte"));
    expect(pot.label).toContain("envoi simulé");
    const line = account.entries.find((e: { label: string }) => e.label.startsWith("Cotisation"));
    expect(Math.abs(new Date(line.occurredAt).getTime() - paidAt.getTime())).toBeLessThan(5000);
  });
});

// D117: the group page by turn, and the compliance view by name.
describe("the group page and the compliance view (D117)", () => {
  it("shows each seat by its turn, never by name, and this round's payments with their references", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    const page = (await (await officer()).get(`/v1/console/groups/${groupId}`)).body;
    expect(page.seats.map((s: { turn: number }) => s.turn)).toEqual([1, 2, 3]);
    expect(page.seats[0]).toMatchObject({ advanceFcfa: 2500, owedFcfa: 0, reported: false });
    expect(page.advancesInFcfa).toBe(7500);
    expect(page.shownRound).toMatchObject({ number: 1, expectedFcfa: 15000 });
    expect(page.shownRound.payments).toHaveLength(3);
    expect(page.shownRound.payments[0]).toMatchObject({ operator: "Mixx by Yas", amountFcfa: 7500, status: "PAID" });
    expect(page.history.map((h: { event: string }) => h.event)).toContain("STARTED");
    // No name anywhere on the page (D33).
    expect(JSON.stringify(page)).not.toMatch(/Akossiwa|Abla|Koffi/);
  });

  it("opens the compliance view to an administrator with a reason, logs it, and shows the legal names", async () => {
    const { groupId, members } = await activeGroup();
    await pay(members[1] as Client, groupId, 1);
    const admin = await officer("MAWULI", "adjo@mawuli.example", "ADMIN");
    expect((await admin.post(`/v1/console/groups/${groupId}/compliance`, {})).status).toBe(400);
    const res = await admin.post(`/v1/console/groups/${groupId}/compliance`, { reason: "Contrôle LBC/FT" });
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { legalName: string }) => m.legalName)).toContain("Abla Agbeko");
    expect(res.body.rounds[0].payments[0]).toMatchObject({ legalName: "Abla Agbeko", amountFcfa: 7500 });
    expect(new Date(res.body.closesAt).getTime() - new Date(res.body.openedAt).getTime()).toBe(15 * 60_000);
    expect(await prisma.auditEvent.count({ where: { type: "STAFF_COMPLIANCE_OPENED" } })).toBe(1);
  });

  it("keeps the compliance view from an ordinary officer", async () => {
    const { groupId } = await activeGroup();
    const res = await (await officer()).post(`/v1/console/groups/${groupId}/compliance`, { reason: "curiosité" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("COMPLIANCE_ONLY");
  });

  it("lets a compliance officer read and open the view, but release no pot", async () => {
    const { groupId, members } = await activeGroup();
    for (const member of members) await pay(member, groupId, 1);
    await makeDue(groupId, 1);
    await runPayouts();
    const essi = await officer("MAWULI", "essi@mawuli.example", "COMPLIANCE");
    const [ready] = (await essi.get("/v1/console/attention")).body;
    const res = await essi.post(`/v1/console/payouts/${ready.payoutId}/release`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("READ_ONLY_ROLE");
    expect((await essi.post(`/v1/console/groups/${groupId}/compliance`, { reason: "Contrôle LBC/FT" })).status).toBe(200);
  });
});
