import type { EmailMessage, EmailProvider } from "./EmailProvider.js";

// Keeps emails in memory (tests read them) and prints the subject, so a
// developer sees what would have been sent.
export class MockEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (process.env.NODE_ENV !== "test") {
      console.log(
        `[mock email] to ${message.to.map((t) => t.email).join(", ")}: ${message.subject}`,
      );
    }
  }
}
