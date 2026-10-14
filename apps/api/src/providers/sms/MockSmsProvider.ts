import type { SmsProvider } from "./SmsProvider.js";

export type SentSms = { to: string; text: string; sentAt: Date };

// Prints messages to the server log instead of sending them, and keeps them
// in memory so tests can read what was "sent".
export class MockSmsProvider implements SmsProvider {
  readonly sent: SentSms[] = [];

  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text, sentAt: new Date() });
    console.log(`[mock SMS] to ${to}: ${text}`);
  }
}