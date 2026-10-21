import type { IdentityProvider } from "./identity/IdentityProvider.js";
import { MockAnidProvider } from "./identity/MockAnidProvider.js";
import type { MfiAdapter } from "./mfi/MfiAdapter.js";
import { MockMfiAdapter } from "./mfi/MockMfiAdapter.js";
import { FedaPayProvider } from "./payment/FedaPayProvider.js";
import { MockPaymentProvider } from "./payment/MockPaymentProvider.js";
import type { PaymentProvider } from "./payment/PaymentProvider.js";
import type { SmsProvider } from "./sms/SmsProvider.js";
import { MockSmsProvider } from "./sms/MockSmsProvider.js";

// The one place that decides which implementation the API uses. Everything
// else depends only on the interfaces, so replacing a mock with a real
// provider changes this file and nothing else (D3).
export const sms: SmsProvider = new MockSmsProvider();
export const identity: IdentityProvider = new MockAnidProvider();
export const mfi: MfiAdapter = new MockMfiAdapter();

// Payments: FedaPay's sandbox when PAYMENT_PROVIDER=fedapay and its keys are
// set in .env; otherwise the mock. Tests always use the mock.
function choosePayments(): PaymentProvider {
  const { PAYMENT_PROVIDER, FEDAPAY_SECRET_KEY, FEDAPAY_WEBHOOK_SECRET, MOCK_PAYMENTS_CONFIRM_MS, PORT } = process.env;
  if (PAYMENT_PROVIDER === "fedapay" && process.env.NODE_ENV !== "test") {
    if (!FEDAPAY_SECRET_KEY || !FEDAPAY_WEBHOOK_SECRET) {
      throw new Error("PAYMENT_PROVIDER=fedapay needs FEDAPAY_SECRET_KEY and FEDAPAY_WEBHOOK_SECRET in .env.");
    }
    return new FedaPayProvider(FEDAPAY_SECRET_KEY, FEDAPAY_WEBHOOK_SECRET);
  }
  const delayMs = Number(MOCK_PAYMENTS_CONFIRM_MS);
  return new MockPaymentProvider(
    delayMs > 0 ? { delayMs, webhookUrl: `http://localhost:${PORT ?? 3000}/v1/webhooks/payments` } : undefined,
  );
}

export const payments: PaymentProvider = choosePayments();
