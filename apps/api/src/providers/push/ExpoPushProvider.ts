import type { PushMessage, PushProvider } from "./PushProvider.js";

// Expo's push service: free, and it forwards to Google's (FCM) and Apple's
// services, so Novi keeps one list of tokens for both kinds of phone. An
// access token (EXPO_ACCESS_TOKEN) is optional; with it, only Novi's server
// can send to Novi's phones.
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
