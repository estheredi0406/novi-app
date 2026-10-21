import type { CollectionRequest, CollectionStatus, MobileOperator, PaymentProvider } from "./PaymentProvider.js";
import { verifySignature } from "./webhookSignature.js";

// Collects contributions through FedaPay, which reaches Moov Money and
// T-Money in Togo. Written from FedaPay's documentation and the request and
// response shapes in its official Node library's tests; it calls the API with
// Node's own fetch instead of that library, whose HTTP client (axios 0.28)
// has known high-severity advisories.
//
// Each payment is three calls:
//   1. POST /v1/transactions                create the transaction
//   2. POST /v1/transactions/{id}/token     get a payment token
//   3. POST /v1/{mode}                      send the request to her phone ("send now")
// Status is read back with GET /v1/transactions/{id}.
//
// Sandbox: https://sandbox-api.fedapay.com. Live mode needs a registered
// company in a FedaPay country, and under D34 the merchant account belongs to
// the MFI that holds the money, not to Novi.

// FedaPay's names for the Togolese operators ("send now" modes).
const MODES: Record<MobileOperator, string> = { MOOV_TG: "moov_tg", TOGOCEL: "togocel" };

type FedaPayTransaction = { id: number; status: string; amount: number };

export class FedaPayProvider implements PaymentProvider {
  readonly name = "fedapay";

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = "https://sandbox-api.fedapay.com",
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`FedaPay ${method} ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  async requestCollection(request: CollectionRequest): Promise<{ providerRef: string }> {
    const phoneNumber = { number: request.phone, country: "tg" };
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

    const { token } = await this.call<{ token: string }>("POST", `/transactions/${transaction.id}/token`);
    await this.call("POST", `/${MODES[request.operator]}`, { token, phone_number: phoneNumber });
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

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): { providerRef: string } {
    if (!verifySignature(rawBody, signatureHeader, this.webhookSecret)) throw new Error("bad signature");
    const event = JSON.parse(rawBody) as { entity?: { id?: number | string } };
    if (event.entity?.id === undefined) throw new Error("webhook without a transaction");
    return { providerRef: String(event.entity.id) };
  }
}
