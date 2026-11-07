import type { SmsProvider } from "./SmsProvider.js";

// Sends real SMS to Rwandan numbers through Pindo, a provider based in Kigali,
// at about 0.01 USD an SMS on MTN Rwanda (Pindo's calculator, Nov 2026): the
// pilot is run from Kigali (D111). Pindo does not reach Togo.
export class PindoSmsProvider implements SmsProvider {
  constructor(
    private readonly token: string,
    private readonly sender: string, // a sender ID registered in the Pindo account
  ) {}

  async send(to: string, text: string): Promise<void> {
    const res = await fetch("https://api.pindo.io/v1/sms/", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, text, sender: this.sender }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Pindo refused the SMS (${res.status}): ${detail.slice(0, 200)}`);
    }
  }
}
