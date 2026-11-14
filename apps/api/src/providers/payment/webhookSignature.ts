import { createHmac, timingSafeEqual } from "node:crypto";

// FedaPay's webhook signature (from its Node library): HMAC-SHA256 of
// "<time>.<body>". Signatures older than 5 minutes are refused so an old
// webhook cannot be replayed. The mock signs the same way.

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
