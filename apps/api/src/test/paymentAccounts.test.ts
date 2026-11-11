import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/db.js";
import { open } from "../lib/secretBox.js";
import { base32Decode, codeForStep, totpStep } from "../lib/totp.js";
import { sign } from "../providers/payment/webhookSignature.js";
import { forgetPaymentAccounts } from "../services/paymentAccounts.js";
import { runPayouts } from "../services/payoutService.js";
import { createStaff } from "../services/staffService.js";
import { ABLA, KOFFI, signedUpMember } from "./helpers.js";

// D102: each MFI connects its own FedaPay account. Members' payments go into
// it and pots leave from it; Novi only gives instructions. FedaPay is played
// here by a fake fetch, so the tests check exactly what Novi asks, and with
// which MFI's key.

const SECRET = "sk_sandbox_fucec_0123456789";
const WEBHOOK = "wh_sandbox_fucec_0123456789";
const GROUP = { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 3, payoutOrder: "DRAWN" };

type Call = { method: string; url: string; auth: string | null; body: unknown };
let calls: Call[] = [];
let fedapay: (call: Call) => { status?: number; json: unknown };

beforeEach(() => {
  calls = [];
  forgetPaymentAccounts();
  fedapay = () => ({ json: {} });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const call = {
      method: init.method ?? "GET",
      url: String(url),
      auth: headers.get("Authorization"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, json } = fedapay(call);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function as(token: string) {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body?: object) => auth(request(app).post(path).send(body ?? {})),
    put: (path: string, body?: object) => auth(request(app).put(path).send(body ?? {})),
  };
}
type Client = ReturnType<typeof as>;

async function staff(email: string, role: "OFFICER" | "ADMIN") {
  await prisma.mfi.upsert({ where: { code: "FUCEC" }, create: { code: "FUCEC", name: "FUCEC-Togo" }, update: {} });
  const { password, totpSecret } = await createStaff({ mfiCode: "FUCEC", email, name: "Adjo Kpodar", role });
  await prisma.staffUser.update({ where: { email }, data: { mustChangePassword: false } });
  const code = codeForStep(base32Decode(totpSecret), totpStep(Date.now()));
  return as((await request(app).post("/v1/staff/login").send({ email, password, code })).body.accessToken);
}

async function activeGroup() {
  const akossiwa = await signedUpMember();
  const abla = await signedUpMember("+22890000002", undefined, ABLA, "Abla");
  const koffi = await signedUpMember("+22890000003", undefined, KOFFI, "Koffi");
  const organiser = as(akossiwa.tokens.accessToken);
  const groupId = (await organiser.post("/v1/groups", GROUP)).body.id as string;
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000002" });
  await organiser.post(`/v1/groups/${groupId}/invites`, { phone: "+22890000003" });
  await organiser.post(`/v1/groups/${groupId}/propose`);
  await as(abla.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await as(koffi.tokens.accessToken).post(`/v1/groups/${groupId}/accept`, { version: 1 });
  await organiser.post(`/v1/groups/${groupId}/start`);
  return { groupId, members: [organiser, as(abla.tokens.accessToken), as(koffi.tokens.accessToken)] };
}

const connect = (admin: Client) =>
  admin.put("/v1/console/payment-account", { secretKey: SECRET, webhookSecret: WEBHOOK, live: false });

// FedaPay's sandbox answering a payment: the transaction, its token, the request to her phone.
function fedapayCollects(status: "pending" | "approved") {
  let next = 9000;
  fedapay = ({ method, url }) => {
    if (method === "POST" && url.endsWith("/v1/transactions")) return { json: { "v1/transaction": { id: ++next, status: "pending", amount: 7500 } } };
    if (url.includes("/token")) return { json: { token: "tok", url: "https://sandbox-checkout.fedapay.com/x" } };
    if (method === "GET" && /\/v1\/transactions\/\d+$/.test(url)) return { json: { "v1/transaction": { id: next, status, amount: 7500 } } };
    return { json: {} };
  };
}

describe("connecting the MFI's own FedaPay account (D102)", () => {
  it("checks the keys with FedaPay, stores them encrypted, and never shows them again", async () => {
    const admin = await staff("adjo@fucec.example", "ADMIN");
    const res = await connect(admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, live: false, payoutsViaFedapay: true, webhookPath: "/v1/webhooks/payments/FUCEC" });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    // The check went to the sandbox, with this key.
    expect(calls[0]).toMatchObject({ method: "GET", auth: `Bearer ${SECRET}` });
    expect(calls[0]?.url).toBe("https://sandbox-api.fedapay.com/v1/transactions/search");

    const row = await prisma.mfi.findUniqueOrThrow({ where: { code: "FUCEC" } });
    expect(row.fedapaySecretKey).not.toContain(SECRET);
    expect(open(row.fedapaySecretKey as string)).toBe(SECRET);
  });

  it("refuses keys FedaPay does not accept, and saves nothing", async () => {
    const admin = await staff("adjo@fucec.example", "ADMIN");
    fedapay = () => ({ status: 401, json: { message: "Unauthenticated" } });
    const res = await connect(admin);
    expect(res.body.error.code).toBe("PAYMENT_ACCOUNT_REFUSED");
    expect((await prisma.mfi.findUniqueOrThrow({ where: { code: "FUCEC" } })).fedapaySecretKey).toBeNull();
  });

  it("lets only an administrator connect it; officers see whether it is connected", async () => {
    const officer = await staff("mawuli@fucec.example", "OFFICER");
    expect((await connect(officer)).body.error.code).toBe("ADMIN_ONLY");
    expect((await officer.get("/v1/console/payment-account")).body).toMatchObject({ connected: false, usesDemo: true });
  });
});

describe("payments into the MFI's account (D102)", () => {
  it("sends her payment to her group's MFI's account, with its key, and credits it on that MFI's webhook", async () => {
    const { groupId, members } = await activeGroup();
    await connect(await staff("adjo@fucec.example", "ADMIN"));
    fedapayCollects("approved");
    calls = [];

    const asked = await (members[1] as Client).post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" });
    expect(asked.status).toBe(202);
    expect(calls.every((c) => c.auth === `Bearer ${SECRET}`)).toBe(true);
    expect(calls[0]?.body).toMatchObject({ amount: 7500, currency: { iso: "XOF" } });
    const mfi = await prisma.mfi.findUniqueOrThrow({ where: { code: "FUCEC" } });
    const row = await prisma.contribution.findUniqueOrThrow({ where: { id: asked.body.id } });
    expect(row).toMatchObject({ provider: "fedapay", paymentAccountMfiId: mfi.id, status: "PENDING" });

    // A notification signed with another secret, or sent to Novi's demo address, changes nothing.
    const body = JSON.stringify({ name: "transaction.approved", entity: { id: Number(row.providerRef) } });
    await request(app).post("/v1/webhooks/payments/FUCEC").set("X-FEDAPAY-SIGNATURE", sign(body, "wrong-secret")).type("json").send(body);
    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");

    // FUCEC's own signed notification: Novi asks FUCEC's account, and credits it.
    const ok = await request(app)
      .post("/v1/webhooks/payments/FUCEC")
      .set("X-FEDAPAY-SIGNATURE", sign(body, WEBHOOK))
      .type("json")
      .send(body);
    expect(ok.status).toBe(200);
    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PAID");
  });

  it("uses Novi's demo account for an MFI not connected yet, only on the pilot", async () => {
    const { groupId, members } = await activeGroup();
    const asked = await (members[1] as Client).post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" });
    expect(asked.status).toBe(202);
    expect((await prisma.contribution.findUniqueOrThrow({ where: { id: asked.body.id } })).paymentAccountMfiId).toBeNull();
  });

  it("refuses payments in production while the MFI has no account, with a clear reason", async () => {
    const { groupId, members } = await activeGroup();
    vi.stubEnv("REQUIRE_MFI_PAYMENT_ACCOUNT", "true");
    const asked = await (members[1] as Client).post(`/v1/groups/${groupId}/rounds/1/pay`, { operator: "TOGOCEL" });
    expect(asked.status).toBe(409);
    expect(asked.body.error.code).toBe("MFI_PAYMENTS_NOT_CONNECTED");
    expect(await prisma.contribution.count()).toBe(0);
  });
});

describe("pots out of the MFI's account (D102)", () => {
  async function fullDuePot() {
    const g = await activeGroup();
    // The payments themselves went through Novi's demo account; what matters here is the pot.
    for (const member of g.members) {
      const asked = await member.post(`/v1/groups/${g.groupId}/rounds/1/pay`, { operator: "TOGOCEL" });
      await prisma.contribution.update({ where: { id: asked.body.id }, data: { status: "PAID", paidAt: new Date() } });
      await prisma.ledgerEntry.create({
        data: { groupId: g.groupId, contributionId: asked.body.id, type: "CONTRIBUTION", amountFcfa: 5000 },
      }).catch(() => undefined);
    }
    await prisma.round.update({
      where: { groupId_number: { groupId: g.groupId, number: 1 } },
      data: { dueDate: new Date("2026-01-02T00:00:00Z") },
    });
    return g;
  }

  it("sends the pot by FedaPay payout from the MFI's balance, then follows it until sent", async () => {
    const { groupId } = await fullDuePot();
    await connect(await staff("adjo@fucec.example", "ADMIN"));
    let state = "started";
    fedapay = ({ method, url }) => {
      if (method === "POST" && url.endsWith("/v1/payouts")) return { json: { "v1/payout": { id: 77, status: "pending" } } };
      if (method === "PUT" && url.endsWith("/v1/payouts/start")) return { json: [{ id: 77, status: state }] };
      if (method === "GET" && url.endsWith("/v1/payouts/77")) return { json: { "v1/payout": { id: 77, status: state } } };
      return { json: {} };
    };
    calls = [];
    await runPayouts(); // 15 000 F, under the automatic limit (D105)

    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/payouts"));
    expect(create).toMatchObject({ auth: `Bearer ${SECRET}`, body: { amount: 15000, currency: { iso: "XOF" } } });
    expect(calls.some((c) => c.method === "PUT" && c.url.endsWith("/v1/payouts/start"))).toBe(true);
    let payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId } } });
    expect(payout).toMatchObject({ status: "SENT", sentVia: "fedapay", mfiRef: "fedapay:77" });

    state = "sent";
    await runPayouts();
    payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId } } });
    expect(payout.status).toBe("PAID");
  });

  it("sends pots through the MFI stand-in when the administrator turns FedaPay payouts off", async () => {
    const { groupId } = await fullDuePot();
    const admin = await staff("adjo@fucec.example", "ADMIN");
    await connect(admin);
    expect((await admin.put("/v1/console/payment-account/payouts", { fedapay: false })).body.payoutsViaFedapay).toBe(false);
    calls = [];
    await runPayouts();
    expect(calls.some((c) => c.url.includes("/payouts"))).toBe(false);
    const payout = await prisma.payout.findFirstOrThrow({ where: { round: { groupId } } });
    expect(payout).toMatchObject({ status: "PAID", sentVia: "mfi" });
  });
});

describe("the real balance of the MFI's account (D113)", () => {
  it("reads the balance from FedaPay with the MFI's own key, and shows it in the console", async () => {
    const admin = await staff("adjo@fucec.example", "ADMIN");
    await connect(admin);
    fedapay = ({ url }) =>
      url.endsWith("/v1/balances")
        ? { json: [{ id: 1, amount: 40000, mode: "mtn_tg" }, { id: 2, amount: 2500, mode: "moov_tg" }] }
        : { json: {} };
    const accounts = (await admin.get("/v1/console/accounts")).body;
    expect(accounts.fedapay).toMatchObject({ source: "mfi", amountFcfa: 42500 });
    const read = calls.find((c) => c.url.endsWith("/v1/balances"));
    expect(read?.auth).toBe(`Bearer ${SECRET}`);
  });

  it("shows no figure, not a wrong one, when FedaPay does not answer", async () => {
    const admin = await staff("adjo@fucec.example", "ADMIN");
    await connect(admin);
    fedapay = ({ url }) => (url.endsWith("/v1/balances") ? { status: 500, json: {} } : { json: {} });
    const accounts = (await admin.get("/v1/console/accounts")).body;
    expect(accounts.fedapay).toMatchObject({ source: "mfi", amountFcfa: null });
  });
});
