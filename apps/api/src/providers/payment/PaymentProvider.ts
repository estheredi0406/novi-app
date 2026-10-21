// How Novi asks for a contribution to be collected from a member's mobile
// money wallet (D3). The member confirms the payment on her own phone with
// her mobile money PIN, which Novi never sees.

export type MobileOperator = "MOOV_TG" | "TOGOCEL";

export type CollectionRequest = {
  reference: string; // Novi's contribution ID, kept by the provider with the transaction
  amountFcfa: number;
  phone: string; // "+22890123456"
  operator: MobileOperator;
  description: string; // shown to her by the provider, e.g. "Novi, Pagnes Assigamé, round 1"
  payerName: string;
};

// What the provider says about a transaction when asked directly.
export type CollectionStatus = { status: "PENDING" | "PAID" | "FAILED"; amountFcfa: number };

export interface PaymentProvider {
  readonly name: string; // stored with each contribution: "mock" or "fedapay"

  // Asks the provider to send the payment request to her phone.
  requestCollection(request: CollectionRequest): Promise<{ providerRef: string }>;

  // Reads the true state of a transaction from the provider. A webhook only
  // says "something changed"; its own status is never trusted, because
  // FedaPay advises checking a transaction by ID through the API.
  getStatus(providerRef: string): Promise<CollectionStatus>;

  // Checks that a webhook really comes from the provider (its signature) and
  // returns the transaction it is about. Throws if the signature is wrong.
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): { providerRef: string };
}
