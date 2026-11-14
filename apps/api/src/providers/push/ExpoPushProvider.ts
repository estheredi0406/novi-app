import type { PushMessage, PushProvider } from "./PushProvider.js";

// Expo's push service: free, and it covers both Android and iPhone with one
// list of tokens.
const URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100; // Expo takes at most 100 messages per request

export class ExpoPushProvider implements PushProvider {
  constructor(private readonly accessToken?: string) {}

  async send(messages: PushMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH).map((m) => ({ ...m, sound: "default", priority: "high" }));
      try {
        const res = await fetch(URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) console.error(`Expo push answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      } catch (err) {
        console.error("Expo push not reached:", err);
      }
    }
  }
}
