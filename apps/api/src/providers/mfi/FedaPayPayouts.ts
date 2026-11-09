import type { PayoutAnswer, PayoutRequest } from "./MfiAdapter.js";
import type { SandboxPayer } from "../payment/FedaPayProvider.js";

// D102: a pot sent from the MFI's own FedaPay balance to the receiver's
// mobile money number, through FedaPay's payout API, with the MFI's key. The
// MFI's officers decide when (D63, D105); FedaPay moves the money; Novi only
// gives the instruction. Two calls: create the payout, then start it.
// Status is read back with GET /v1/payouts/{id} (pending, started,
// processing, sent, failed).
//
// Sandbox: like collections (D64), FedaPay's sandbox may refuse a Togolese
// number, so FEDAPAY_SANDBOX_PAYOUT="mode:country:number" sends sandbox
// payouts to one of its test numbers instead. Never used in live mode.
const MODES: Record<PayoutRequest["operator"], string> = { MOOV_TG: "moov_tg", TOGOCEL: "togocel" };

type FedaPayPayout = { id: number; status: string };
const unwrap = (body: unknown): FedaPayPayout => {
  const wrapped = body as { "v1/payout"?: FedaPayPayout };
  return wrapped["v1/payout"] ?? (body as FedaPayPayout);
};

export class FedaPayPayouts {
  constructor(
    private readonly secretKey: string,
    private readonly baseUrl: string,
    private readonly sandboxPayee?: SandboxPayer,
  ) {
    if (sandboxPayee && !baseUrl.includes("sandbox")) throw new Error("A sandbox test payee cannot be used in live mode.");
  }

  private async call<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const reason = (await res.text()).slice(0, 500);
      throw new Error(`FedaPay ${method} ${path} answered ${res.status}: ${reason}`);
    }
    return (await res.json()) as T;
  }

  private static answer(payout: FedaPayPayout): PayoutAnswer {
    const status = payout.status === "sent" ? "PAID" : payout.status === "failed" ? "FAILED" : "SENT";
    return { mfiRef: `fedapay:${payout.id}`, status };
  }

  async sendPayout(request: PayoutRequest): Promise<PayoutAnswer> {
    const payee = this.sandboxPayee;
    const phone = payee
      ? { number: payee.number, country: payee.country }
      : { number: request.phone.replace(/^\+228/, ""), country: "tg" };
    if (payee) console.warn(`[fedapay sandbox] payout sent to test number ${payee.number}, not ${request.phone}`);
    const created = unwrap(
      await this.call("POST", "/payouts", {
        amount: request.amountFcfa,
        currency: { iso: "XOF" },
        mode: payee?.mode ?? MODES[request.operator],
        // Novi's reference, so the MFI can match the payout in its dashboard.
        merchant_reference: request.payoutId,
        customer: {
          firstname: "Novi",
          lastname: "Membre",
          email: `payout-${request.payoutId}@novi.invalid`,
          phone_number: phone,
        },
      }),
    );
    const started = await this.call<FedaPayPayout[] | { "v1/payouts"?: FedaPayPayout[] }>("PUT", "/payouts/start", [
      { id: created.id, phone_number: phone },
    ]);
    const list = Array.isArray(started) ? started : (started["v1/payouts"] ?? []);
    return FedaPayPayouts.answer(list[0] ?? created);
  }

  async getPayoutStatus(mfiRef: string): Promise<PayoutAnswer> {
    const id = mfiRef.replace(/^fedapay:/, "");
    return FedaPayPayouts.answer(unwrap(await this.call("GET", `/payouts/${id}`)));
  }
}
