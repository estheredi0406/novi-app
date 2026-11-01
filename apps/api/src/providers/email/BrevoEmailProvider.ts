import type { EmailMessage, EmailProvider } from "./EmailProvider.js";

// Brevo's transactional email API (free plan: 300 emails a day). The sender
// address must be one verified in the Brevo account (EMAIL_FROM).
export class BrevoEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Novi", email: this.from },
        to: message.to,
        subject: message.subject,
        textContent: message.text,
        htmlContent: message.html,
      }),
    });
    if (!res.ok)
      throw new Error(`Brevo answered ${res.status}: ${await res.text()}`);
  }
}
