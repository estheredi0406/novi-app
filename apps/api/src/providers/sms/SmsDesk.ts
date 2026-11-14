import { prisma } from "../../lib/db.js";
import type { SmsProvider } from "./SmsProvider.js";
import { toGsm } from "./TwilioSmsProvider.js";

export type SmsRoute = { provider: SmsProvider; real: boolean };

// Every SMS goes through here (D109, D111): it picks the provider by country,
// keeps under the monthly limit and logs each SMS. A failed SMS never stops the
// payment behind it.
export class SmsDesk implements SmsProvider {
  constructor(
    private readonly options: {
      byPrefix: Record<string, SmsRoute>;
      fallback: SmsRoute;
      monthlyLimit: number;
      keepText: boolean;
    },
  ) {}

  private route(to: string): SmsRoute {
    const prefix = Object.keys(this.options.byPrefix).find((p) => to.startsWith(p));
    return prefix ? (this.options.byPrefix[prefix] as SmsRoute) : this.options.fallback;
  }

  // True when a real SMS left for her phone; false when it was simulated,
  // over the month's limit, or failed.
  async send(to: string, text: string): Promise<boolean> {
    const { provider, real } = this.route(to);
    const gsm = toGsm(text);
    if (real) {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const sent = await prisma.smsLog.count({ where: { real: true, createdAt: { gte: monthStart } } });
      if (sent >= this.options.monthlyLimit) {
        console.warn(`SMS limit of ${this.options.monthlyLimit} this month reached: not sent to ${to.slice(0, 7)}…`);
        return false;
      }
    }
    try {
      await provider.send(to, gsm);
    } catch (err) {
      console.error("SMS not sent:", err);
      return false;
    }
    await prisma.smsLog
      .create({ data: { real, phone: this.options.keepText ? to : null, text: this.options.keepText ? gsm : null } })
      .catch((err: unknown) => console.error("SMS log failed:", err));
    return real;
  }
}
