import type { CollectionRequest, CollectionStatus, MobileOperator, PaymentProvider } from "./PaymentProvider.js";
import { verifySignature } from "./webhookSignature.js";

// Collects contributions through FedaPay (Moov Money and T-Money in Togo).
// We call the API with fetch instead of FedaPay's Node library, which depends
// on an old axios version with security advisories.
// A payment is three calls: create the transaction, get a token, send the
// request to her phone. The status is read with GET /v1/transactions/{id}.
// Under D34 the merchant account belongs to the MFI, not to Novi.

// FedaPay's names for the Togolese operators ("send now" modes).
const MODES: Record<MobileOperator, string> = { MOOV_TG: "moov_tg", TOGOCEL: "togocel" };

type FedaPayTransaction = { id: number; status: string; amount: number };

// Sandbox only. FedaPay's test numbers are Beninese and it refuses Togolese
// numbers, so we can redirect the request to a test number, or use "page" for
// FedaPay's payment page. Never used in live mode (D49).
export type SandboxPayer = { mode: string; country: string; number: string };

export const FEDAPAY_SANDBOX_API = "https://sandbox-api.fedapay.com";
export const FEDAPAY_LIVE_API = "https://api.fedapay.com";

export class FedaPayProvider implements PaymentProvider {
  readonly name = "fedapay";

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = "https://sandbox-api.fedapay.com",
    private readonly sandboxPayer?: SandboxPayer,
  ) {
    if (sandboxPayer && !baseUrl.includes("sandbox")) throw new Error("A sandbox test payer cannot be used in live mode.");
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // FedaPay explains a refusal in the body (for example which field it
      // rejected). It is kept in the error, cut short, so the API log says
      // why; the body never contains the secret key.
      const reason = (await res.text()).slice(0, 500);
      throw new Error(`FedaPay ${method} ${path} answered ${res.status}: ${reason}`);
    }
    return (await res.json()) as T;
  }

  async requestCollection(request: CollectionRequest): Promise<{ providerRef: string; paymentUrl?: string }> {
    // In the sandbox with a test payer, the customer gets the test number too:
    // FedaPay's payment page locks the country to the customer's.
    const test = this.sandboxPayer?.number ? this.sandboxPayer : undefined;
    const phoneNumber = test ? { number: test.number, country: test.country } : { number: request.phone, country: "tg" };
    const created = await this.call<{ "v1/transaction": FedaPayTransaction }>("POST", "/transactions", {
      description: request.description,
      amount: request.amountFcfa,
      currency: { iso: "XOF" },
      customer: {
        firstname: request.payerName,
        lastname: "Novi",
        // FedaPay asks for an email for a new customer; members have none, so
        // a non-deliverable address (the .invalid domain, RFC 2606) is used.
        email: `member-${request.reference}@novi.invalid`,
        phone_number: phoneNumber,
      },
    });
    const transaction = created["v1/transaction"];

    const { token, url } = await this.call<{ token: string; url?: string }>("POST", `/transactions/${transaction.id}/token`);
    if (this.sandboxPayer?.mode === "page") {
      // Checkout (D64): she pays on FedaPay's page and FedaPay tells us through the
      // webhook. This sandbox account cannot use "send now".
      if (!url) throw new Error(`FedaPay returned no payment page for transaction ${transaction.id}`);
      console.log(`[fedapay] payment page for transaction ${transaction.id}`);
      return { providerRef: String(transaction.id), paymentUrl: url };
    } else if (this.sandboxPayer) {
      const { mode, country, number } = this.sandboxPayer;
      console.warn(`[fedapay sandbox] payment request sent to test number ${number} (${mode}), not ${request.phone}`);
      await this.call("POST", `/${mode}`, { token, phone_number: { number, country } });
    } else {
      await this.call("POST", `/${MODES[request.operator]}`, { token, phone_number: phoneNumber });
    }
    return { providerRef: String(transaction.id) };
  }

  async getStatus(providerRef: string): Promise<CollectionStatus> {
    const found = await this.call<{ "v1/transaction": FedaPayTransaction }>("GET", `/transactions/${providerRef}`);
    const { status, amount } = found["v1/transaction"];
    // approved and transferred mean the money moved; declined, canceled and
    // refunded mean it did not, or no longer counts.
    const paid = status === "approved" || status === "transferred";
    const failed = status === "declined" || status === "canceled" || status === "refunded";
    return { status: paid ? "PAID" : failed ? "FAILED" : "PENDING", amountFcfa: amount };
  }

  // D102: checks a key before an MFI saves it, with the lightest call
  // FedaPay answers only for a valid key: listing transactions, which its API
  // reference documents as GET /v1/transactions/search.
  async testConnection(): Promise<void> {
    await this.call("GET", "/transactions/search");
  }

  // D113: the account balance, added up over its balances. FedaPay's docs and
  // libraries disagree on the response shape, so we accept both.
  async getBalance(): Promise<number> {
    const body = await this.call<unknown>("GET", "/balances");
    type Row = { amount: number };
    const wrapped = (body ?? {}) as { balances?: Row[]; "v1/balances"?: Row[] };
    const list = Array.isArray(body) ? (body as Row[]) : (wrapped.balances ?? wrapped["v1/balances"] ?? []);
    return list.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  }

  // D102: the API this account answers on, for its payouts.
  get apiBase(): string {
    return this.baseUrl;
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): { providerRef: string } {
    if (!verifySignature(rawBody, signatureHeader, this.webhookSecret)) throw new Error("bad signature");
    const event = JSON.parse(rawBody) as { entity?: { id?: number | string } };
    if (event.entity?.id === undefined) throw new Error("webhook without a transaction");
    return { providerRef: String(event.entity.id) };
  }
}
