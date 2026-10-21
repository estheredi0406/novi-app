import { createHmac, timingSafeEqual } from "node:crypto";

// The webhook signature scheme FedaPay uses (read from its official Node
// library, fedapay-node, Webhook.ts): a header "t=<unix time>,s=<signature>",
// where the signature is HMAC-SHA256 of "<unix time>.<raw body>" with the
// webhook secret. A signature older than 5 minutes is refused, so a recorded
// webhook cannot be replayed later. The mock provider signs the same way, so
// tests exercise the real check.

const TOLERANCE_SEC = 5 * 60;

export function sign(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return `t=${timestamp},s=${signature}`;
}

export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.s) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TOLERANCE_SEC) return false;

  const expected = Buffer.from(sign(rawBody, secret, timestamp).split("s=")[1] ?? "", "utf8");
  const received = Buffer.from(parts.s, "utf8");
  // Compares in constant time, so the signature cannot be guessed byte by byte.
  return expected.length === received.length && timingSafeEqual(expected, received);
}
