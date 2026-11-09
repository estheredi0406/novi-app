import { BrevoEmailProvider } from "./email/BrevoEmailProvider.js";
import type { EmailProvider } from "./email/EmailProvider.js";
import { MockEmailProvider } from "./email/MockEmailProvider.js";
import type { IdentityProvider } from "./identity/IdentityProvider.js";
import { MockAnidProvider } from "./identity/MockAnidProvider.js";
import type { MfiAdapter } from "./mfi/MfiAdapter.js";
import { MockMfiAdapter } from "./mfi/MockMfiAdapter.js";
import { FedaPayProvider, type SandboxPayer } from "./payment/FedaPayProvider.js";
import { MockPaymentProvider } from "./payment/MockPaymentProvider.js";
import type { PaymentProvider } from "./payment/PaymentProvider.js";
import { DailyMeetingProvider } from "./meeting/DailyMeetingProvider.js";
import type { MeetingProvider } from "./meeting/MeetingProvider.js";
import { MockMeetingProvider } from "./meeting/MockMeetingProvider.js";
import { NoviMeetingProvider } from "./meeting/NoviMeetingProvider.js";
import { ExpoPushProvider } from "./push/ExpoPushProvider.js";
import { MockPushProvider } from "./push/MockPushProvider.js";
import type { PushProvider } from "./push/PushProvider.js";
import type { SmsProvider } from "./sms/SmsProvider.js";
import { MockSmsProvider } from "./sms/MockSmsProvider.js";
import { PindoSmsProvider } from "./sms/PindoSmsProvider.js";
import { SmsDesk, type SmsRoute } from "./sms/SmsDesk.js";
import { TwilioSmsProvider } from "./sms/TwilioSmsProvider.js";

// The one place that decides which implementation the API uses. Everything
// else depends only on the interfaces, so replacing a mock with a real
// provider changes this file and nothing else (D3).
// SMS (D109, D111). Rwandan numbers (the pilot, run from Kigali) go to Pindo
// when PINDO_API_TOKEN and PINDO_SENDER are set; Togolese numbers go to Twilio
// when SMS_PROVIDER=twilio and its keys are set; everything else is simulated
// by the mock. Real SMS are capped at SMS_MONTHLY_LIMIT a month (200 if
// unset). With PILOT_SHOW_SMS=true, the text of each SMS is kept for the
// tester's "Mes SMS" screen. Tests always use the bare mock.
function chooseSms(): SmsProvider {
  if (process.env.NODE_ENV === "test") return new MockSmsProvider();
  const {
    SMS_PROVIDER,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM,
    PINDO_API_TOKEN,
    PINDO_SENDER,
    SMS_MONTHLY_LIMIT,
    PILOT_SHOW_SMS,
  } = process.env;
  const mock: SmsRoute = { provider: new MockSmsProvider(), real: false };
  let togo: SmsRoute = mock;
  if (SMS_PROVIDER === "twilio") {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
      throw new Error("SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in .env.");
    }
    togo = { provider: new TwilioSmsProvider(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM), real: true };
  }
  const byPrefix: Record<string, SmsRoute> = {};
  if (PINDO_API_TOKEN) {
    if (!PINDO_SENDER) throw new Error("PINDO_API_TOKEN needs PINDO_SENDER (a sender ID registered at Pindo) in .env.");
    byPrefix["+250"] = { provider: new PindoSmsProvider(PINDO_API_TOKEN, PINDO_SENDER), real: true };
  }
  const limit = Number(SMS_MONTHLY_LIMIT ?? 200);
  return new SmsDesk({
    byPrefix,
    fallback: togo,
    monthlyLimit: Number.isFinite(limit) && limit >= 0 ? limit : 200,
    keepText: PILOT_SHOW_SMS === "true",
  });
}

export const sms: SmsProvider = chooseSms();
export const identity: IdentityProvider = new MockAnidProvider();
export const mfi: MfiAdapter = new MockMfiAdapter();

// Optional, sandbox only: FEDAPAY_SANDBOX_PAYER="moov:bj:64000001" sends
// every payment request to that FedaPay test number (see SandboxPayer);
// "page:bj:66000001" (or just "page") prints FedaPay's payment page instead.
// FEDAPAY_SANDBOX_PAYOUT does the same for pots sent by payout (D102).
export function sandboxPayer(name: "FEDAPAY_SANDBOX_PAYER" | "FEDAPAY_SANDBOX_PAYOUT"): SandboxPayer | undefined {
  const [mode, country, number] = (process.env[name] ?? "").split(":");
  if (mode === "page" && !number) return { mode, country: "", number: "" };
  return mode && country && number ? { mode, country, number } : undefined;
}

// Payments: FedaPay's sandbox when PAYMENT_PROVIDER=fedapay and its keys are
// set in .env; otherwise the mock. Tests always use the mock.
function choosePayments(): PaymentProvider {
  const {
    PAYMENT_PROVIDER,
    FEDAPAY_SECRET_KEY,
    FEDAPAY_WEBHOOK_SECRET,
    MOCK_PAYMENTS_CONFIRM_MS,
    PORT,
  } = process.env;
  if (PAYMENT_PROVIDER === "fedapay" && process.env.NODE_ENV !== "test") {
    if (!FEDAPAY_SECRET_KEY || !FEDAPAY_WEBHOOK_SECRET) {
      throw new Error(
        "PAYMENT_PROVIDER=fedapay needs FEDAPAY_SECRET_KEY and FEDAPAY_WEBHOOK_SECRET in .env.",
      );
    }
    return new FedaPayProvider(
      FEDAPAY_SECRET_KEY,
      FEDAPAY_WEBHOOK_SECRET,
      undefined,
      sandboxPayer("FEDAPAY_SANDBOX_PAYER"),
    );
  }
  const delayMs = Number(MOCK_PAYMENTS_CONFIRM_MS);
  return new MockPaymentProvider(
    delayMs > 0
      ? {
          delayMs,
          webhookUrl: `http://localhost:${PORT ?? 3000}/v1/webhooks/payments`,
        }
      : undefined,
  );
}

export const payments: PaymentProvider = choosePayments();

// Group calls and meetings: Novi's own (D112), served by this API, with no
// outside call service. Daily (D71) stays coded, used only when
// MEETINGS_PROVIDER=daily and DAILY_API_KEY are set. Tests use the mock.
function chooseMeetings(): MeetingProvider {
  if (process.env.NODE_ENV === "test") return new MockMeetingProvider();
  const key = process.env.DAILY_API_KEY;
  if (process.env.MEETINGS_PROVIDER === "daily" && key) return new DailyMeetingProvider(key);
  // The address phones use to reach this API: Render sets RENDER_EXTERNAL_URL.
  const base =
    process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  return new NoviMeetingProvider(base.replace(/\/$/, ""));
}

export const meetings: MeetingProvider = chooseMeetings();

// Phone notifications (D79): Expo's push service, which is free and needs
// no key; EXPO_ACCESS_TOKEN, if set, locks sending to Novi's server. Tests
// always use the mock.
function choosePush(): PushProvider {
  if (process.env.NODE_ENV === "test" || process.env.NOTIFICATIONS_OFF)
    return new MockPushProvider();
  return new ExpoPushProvider(process.env.EXPO_ACCESS_TOKEN || undefined);
}

export const push: PushProvider = choosePush();

// Email to MFI staff (D90): Brevo when EMAIL_PROVIDER=brevo, with BREVO_API_KEY
// and EMAIL_FROM (an address verified in Brevo); otherwise the mock, which
// only prints. Tests always use the mock.
function chooseEmail(): EmailProvider {
  const { EMAIL_PROVIDER, BREVO_API_KEY, EMAIL_FROM } = process.env;
  if (EMAIL_PROVIDER === "brevo" && process.env.NODE_ENV !== "test") {
    if (!BREVO_API_KEY || !EMAIL_FROM)
      throw new Error(
        "EMAIL_PROVIDER=brevo needs BREVO_API_KEY and EMAIL_FROM in .env.",
      );
    return new BrevoEmailProvider(BREVO_API_KEY, EMAIL_FROM);
  }
  return new MockEmailProvider();
}

export const email: EmailProvider = chooseEmail();
