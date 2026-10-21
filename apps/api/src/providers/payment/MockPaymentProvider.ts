import { randomUUID } from "node:crypto";
import type { CollectionRequest, CollectionStatus, PaymentProvider } from "./PaymentProvider.js";
import { sign, verifySignature } from "./webhookSignature.js";

export const MOCK_WEBHOOK_SECRET = "mock-webhook-secret";

type MockTransaction = CollectionRequest & CollectionStatus & { providerRef: string };

// Stands in for FedaPay in tests and on a laptop. It keeps transactions in
// memory and, like FedaPay, tells the API about a change by webhook, signed
// the same way, so the API's real webhook route is used.
// - In tests, a test decides the outcome with settle(), then sends the webhook.
// - In development, set MOCK_PAYMENTS_CONFIRM_MS (e.g. 4000): each payment
//   then "succeeds" after that delay and the webhook is posted to the local
//   API, as if she had confirmed on her phone.
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly transactions = new Map<string, MockTransaction>();

  constructor(private readonly autoConfirm?: { delayMs: number; webhookUrl: string }) {}

  async requestCollection(request: CollectionRequest): Promise<{ providerRef: string }> {
    const providerRef = `mock_${randomUUID().slice(0, 8)}`;
    this.transactions.set(providerRef, { ...request, providerRef, status: "PENDING" });
    console.log(`[mock payment] ${request.amountFcfa} FCFA requested from ${request.phone} (${providerRef})`);

    if (this.autoConfirm) {
      const { delayMs, webhookUrl } = this.autoConfirm;
      setTimeout(() => {
        const webhook = this.settle(providerRef, "PAID");
        void fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-FEDAPAY-SIGNATURE": webhook.signature },
          body: webhook.body,
        }).catch((err: unknown) => console.error("[mock payment] webhook failed", err));
      }, delayMs);
    }
    return { providerRef };
  }

  async getStatus(providerRef: string): Promise<CollectionStatus> {
    const transaction = this.transactions.get(providerRef);
    if (!transaction) throw new Error(`unknown mock transaction ${providerRef}`);
    return { status: transaction.status, amountFcfa: transaction.amountFcfa };
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): { providerRef: string } {
    if (!verifySignature(rawBody, signatureHeader, MOCK_WEBHOOK_SECRET)) throw new Error("bad signature");
    const event = JSON.parse(rawBody) as { entity?: { id?: string } };
    if (!event.entity?.id) throw new Error("webhook without a transaction");
    return { providerRef: event.entity.id };
  }

  // Decides what happened on her phone, and returns the webhook FedaPay would
  // send about it: a body shaped like FedaPay's ({ name, entity }) and its
  // signature header. amountFcfa can differ, to test a wrong amount.
  settle(providerRef: string, status: "PAID" | "FAILED", amountFcfa?: number) {
    const transaction = this.transactions.get(providerRef);
    if (!transaction) throw new Error(`unknown mock transaction ${providerRef}`);
    transaction.status = status;
    if (amountFcfa !== undefined) transaction.amountFcfa = amountFcfa;

    const body = JSON.stringify({
      name: status === "PAID" ? "transaction.approved" : "transaction.declined",
      entity: { id: providerRef },
    });
    return { body, signature: sign(body, MOCK_WEBHOOK_SECRET) };
  }
}
