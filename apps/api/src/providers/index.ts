import type { IdentityProvider } from "./identity/IdentityProvider.js";
import { MockAnidProvider } from "./identity/MockAnidProvider.js";
import type { MfiAdapter } from "./mfi/MfiAdapter.js";
import { MockMfiAdapter } from "./mfi/MockMfiAdapter.js";
import { FedaPayProvider } from "./payment/FedaPayProvider.js";
import { MockPaymentProvider } from "./payment/MockPaymentProvider.js";
import type { PaymentProvider } from "./payment/PaymentProvider.js";
import { DailyMeetingProvider } from "./meeting/DailyMeetingProvider.js";
import type { MeetingProvider } from "./meeting/MeetingProvider.js";
import { MockMeetingProvider } from "./meeting/MockMeetingProvider.js";
import { ExpoPushProvider } from "./push/ExpoPushProvider.js";
import { MockPushProvider } from "./push/MockPushProvider.js";
import type { PushProvider } from "./push/PushProvider.js";
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
    // Optional, sandbox only: FEDAPAY_SANDBOX_PAYER="moov:bj:64000001" sends
    // every payment request to that FedaPay test number (see SandboxPayer).
    const [mode, country, number] = (process.env.FEDAPAY_SANDBOX_PAYER ?? "").split(":");
    // FEDAPAY_SANDBOX_PAYER="page:bj:66000001" prints FedaPay's payment page
    // instead, set up for that test number.
    const sandboxPayer =
      mode === "page" && !number ? { mode, country: "", number: "" } : mode && country && number ? { mode, country, number } : undefined;
    return new FedaPayProvider(FEDAPAY_SECRET_KEY, FEDAPAY_WEBHOOK_SECRET, undefined, sandboxPayer);
  }
  const delayMs = Number(MOCK_PAYMENTS_CONFIRM_MS);
  return new MockPaymentProvider(
    delayMs > 0 ? { delayMs, webhookUrl: `http://localhost:${PORT ?? 3000}/v1/webhooks/payments` } : undefined,
  );
}

export const payments: PaymentProvider = choosePayments();

// Group meetings (D71): Daily when DAILY_API_KEY is set in .env; otherwise
// the mock, whose rooms lead nowhere. Tests always use the mock.
function chooseMeetings(): MeetingProvider {
  const key = process.env.DAILY_API_KEY;
  if (key && process.env.NODE_ENV !== "test") return new DailyMeetingProvider(key);
  return new MockMeetingProvider();
}

export const meetings: MeetingProvider = chooseMeetings();

// Phone notifications (D79): Expo's push service, which is free and needs
// no key; EXPO_ACCESS_TOKEN, if set, locks sending to Novi's server. Tests
// always use the mock.
function choosePush(): PushProvider {
  if (process.env.NODE_ENV === "test" || process.env.NOTIFICATIONS_OFF) return new MockPushProvider();
  return new ExpoPushProvider(process.env.EXPO_ACCESS_TOKEN || undefined);
}

export const push: PushProvider = choosePush();
