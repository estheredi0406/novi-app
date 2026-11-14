import type { Mfi } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { pilotMode } from "../lib/pilot.js";
import { open, seal } from "../lib/secretBox.js";
import { mfi as mfiStandIn, payments as noviDemoAccount, sandboxPayer } from "../providers/index.js";
import type { PayoutAnswer, PayoutRequest } from "../providers/mfi/MfiAdapter.js";
import { FedaPayPayouts } from "../providers/mfi/FedaPayPayouts.js";
import {
  FEDAPAY_LIVE_API,
  FEDAPAY_SANDBOX_API,
  FedaPayProvider,
} from "../providers/payment/FedaPayProvider.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import type { PaymentProvider } from "../providers/payment/PaymentProvider.js";

// D102: whose FedaPay account a payment goes into and a pot leaves from. Each
// MFI connects its own, so Novi never holds money (D2, D34). Without one, the
// pilot uses Novi's demo account.

type PayoutSender = {
  sendPayout(request: PayoutRequest): Promise<PayoutAnswer>;
  getPayoutStatus(mfiRef: string): Promise<PayoutAnswer>;
};

export type PaymentAccount = {
  mfiId: string | null; // null: Novi's demo account
  payments: PaymentProvider;
  payouts: PayoutSender;
  sentVia: "fedapay" | "mfi";
};

const DEMO: PaymentAccount = { mfiId: null, payments: noviDemoAccount, payouts: mfiStandIn, sentVia: "mfi" };

// The demo account may stand in only where no real money can move.
// REQUIRE_MFI_PAYMENT_ACCOUNT=true refuses it everywhere, as in production.
function demoAllowed(): boolean {
  if (process.env.REQUIRE_MFI_PAYMENT_ACCOUNT === "true") return false;
  return process.env.NODE_ENV === "test" || pilotMode() || noviDemoAccount instanceof MockPaymentProvider;
}

// Built once per MFI and kept until its keys change.
const cache = new Map<string, PaymentAccount>();

function build(m: Mfi): PaymentAccount {
  const base = m.fedapayLive ? FEDAPAY_LIVE_API : FEDAPAY_SANDBOX_API;
  const sandbox = !m.fedapayLive;
  const key = open(m.fedapaySecretKey as string);
  const payments = new FedaPayProvider(
    key,
    open(m.fedapayWebhookSecret as string),
    base,
    sandbox ? sandboxPayer("FEDAPAY_SANDBOX_PAYER") : undefined,
  );
  const payouts = m.fedapayPayouts
    ? new FedaPayPayouts(key, base, sandbox ? sandboxPayer("FEDAPAY_SANDBOX_PAYOUT") : undefined)
    : mfiStandIn;
  return { mfiId: m.id, payments, payouts, sentVia: m.fedapayPayouts ? "fedapay" : "mfi" };
}


export async function accountForMfi(mfiId: string): Promise<PaymentAccount> {
  const cached = cache.get(mfiId);
  if (cached) return cached;
  const m = await prisma.mfi.findUnique({ where: { id: mfiId } });
  if (m?.fedapaySecretKey && m.fedapayWebhookSecret) {
    const account = build(m);
    cache.set(mfiId, account);
    return account;
  }
  if (demoAllowed()) return DEMO;
  throw new AppError("MFI_PAYMENTS_NOT_CONNECTED", 409);
}

// The account a payment went through, to ask about it later.
export async function accountForPayment(paymentAccountMfiId: string | null): Promise<PaymentAccount> {
  return paymentAccountMfiId ? accountForMfi(paymentAccountMfiId) : DEMO;
}

// ---------- D113: the balance the account really holds ----------

const balances = new Map<string, { amountFcfa: number; checkedAt: Date }>();
const BALANCE_TTL_MS = 20_000;

export type AccountBalance = {
  source: "mfi" | "demo";
  live: boolean; // D150: false for a FedaPay test (sandbox) account
  amountFcfa: number | null; // null: FedaPay did not answer
  checkedAt: string | null;
};

// The FedaPay balance of this MFI's account (or of Novi's demo account on the
// pilot), read from FedaPay, kept 20 seconds, and read again as soon as a
// payment notification arrives. Null when there is no FedaPay account at all.
export async function accountBalance(mfiId: string): Promise<AccountBalance | null> {
  const account = await accountForMfi(mfiId).catch(() => null);
  if (!account || !(account.payments instanceof FedaPayProvider)) return null;
  const key = account.mfiId ?? "demo";
  const source = account.mfiId ? "mfi" : "demo";
  const live = !account.payments.apiBase.includes("sandbox");
  const cached = balances.get(key);
  if (cached && Date.now() - cached.checkedAt.getTime() < BALANCE_TTL_MS) {
    return { source, live, amountFcfa: cached.amountFcfa, checkedAt: cached.checkedAt.toISOString() };
  }
  try {
    const amountFcfa = await account.payments.getBalance();
    const checkedAt = new Date();
    balances.set(key, { amountFcfa, checkedAt });
    return { source, live, amountFcfa, checkedAt: checkedAt.toISOString() };
  } catch (err) {
    console.warn("FedaPay balance not read:", err instanceof Error ? err.message.slice(0, 200) : err);
    return { source, live, amountFcfa: null, checkedAt: null };
  }
}

// Money moved: the next look reads FedaPay again.
export function forgetBalance(mfiId: string | null) {
  balances.delete(mfiId ?? "demo");
}

// ---------- In the console (administrators only) ----------

export type PaymentAccountStatus = {
  connected: boolean;
  live: boolean;
  connectedAt: string | null;
  payoutsViaFedapay: boolean;
  usesDemo: boolean; // not connected, and the demo account stands in (pilot)
  webhookPath: string; // where FedaPay must send this MFI's notifications
};

export async function paymentAccountStatus(mfiId: string): Promise<PaymentAccountStatus> {
  const m = await prisma.mfi.findUniqueOrThrow({ where: { id: mfiId } });
  const connected = Boolean(m.fedapaySecretKey && m.fedapayWebhookSecret);
  return {
    connected,
    live: m.fedapayLive,
    connectedAt: m.fedapayConnectedAt?.toISOString() ?? null,
    payoutsViaFedapay: m.fedapayPayouts,
    usesDemo: !connected && demoAllowed(),
    webhookPath: `/v1/webhooks/payments/${encodeURIComponent(m.code)}`,
  };
}

// The administrator pastes the MFI's keys. They are checked with FedaPay
// first, then stored encrypted; Novi never shows them again.
export async function connectPaymentAccount(
  mfiId: string,
  staffId: string,
  input: { secretKey: string; webhookSecret: string; live: boolean },
  check: (provider: FedaPayProvider) => Promise<void> = (p) => p.testConnection(),
): Promise<PaymentAccountStatus> {
  const provider = new FedaPayProvider(
    input.secretKey,
    input.webhookSecret,
    input.live ? FEDAPAY_LIVE_API : FEDAPAY_SANDBOX_API,
  );
  try {
    await check(provider);
  } catch (err) {
    console.warn("FedaPay refused the MFI's key:", err instanceof Error ? err.message.slice(0, 200) : err);
    throw new AppError("PAYMENT_ACCOUNT_REFUSED", 400);
  }
  await prisma.mfi.update({
    where: { id: mfiId },
    data: {
      fedapaySecretKey: seal(input.secretKey),
      fedapayWebhookSecret: seal(input.webhookSecret),
      fedapayLive: input.live,
      fedapayConnectedAt: new Date(),
    },
  });
  cache.delete(mfiId);
  // No key in the log, only that it changed.
  await prisma.auditEvent.create({
    data: { type: "STAFF_PAYMENT_ACCOUNT_CONNECTED", details: { staffId, live: input.live } },
  });
  return paymentAccountStatus(mfiId);
}

export async function disconnectPaymentAccount(mfiId: string, staffId: string): Promise<PaymentAccountStatus> {
  await prisma.mfi.update({
    where: { id: mfiId },
    data: { fedapaySecretKey: null, fedapayWebhookSecret: null, fedapayConnectedAt: null },
  });
  cache.delete(mfiId);
  await prisma.auditEvent.create({ data: { type: "STAFF_PAYMENT_ACCOUNT_DISCONNECTED", details: { staffId } } });
  return paymentAccountStatus(mfiId);
}

// Pots by FedaPay payout, or through the MFI stand-in (for example if the
// sandbox refuses payouts on the day of a demo).
export async function setPayoutsViaFedapay(mfiId: string, staffId: string, on: boolean): Promise<PaymentAccountStatus> {
  await prisma.mfi.update({ where: { id: mfiId }, data: { fedapayPayouts: on } });
  cache.delete(mfiId);
  await prisma.auditEvent.create({ data: { type: "STAFF_PAYOUTS_ROUTE_SET", details: { staffId, fedapay: on } } });
  return paymentAccountStatus(mfiId);
}

// For tests: forget built accounts.
export function forgetPaymentAccounts() {
  cache.clear();
  balances.clear();
}
