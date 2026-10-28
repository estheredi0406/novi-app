import type { PushMessage, PushProvider } from "./PushProvider.js";

// Used in tests, and when NOTIFICATIONS_OFF is set: keeps the messages in
// memory and prints them to the server log.
export class MockPushProvider implements PushProvider {
  readonly sent: PushMessage[] = [];

  async send(messages: PushMessage[]): Promise<void> {
    for (const m of messages) {
      this.sent.push(m);
      if (process.env.NODE_ENV !== "test") console.log(`[mock push] ${m.title}: ${m.body}`);
    }
  }
}
