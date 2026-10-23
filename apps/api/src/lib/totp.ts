import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Codes from an authenticator app (Google Authenticator, Microsoft
// Authenticator and others), as defined by RFC 6238 (TOTP) on top of RFC 4226
// (HOTP). Written with Node's crypto instead of a library, because the method
// is short: the app and the server share a secret, and every 30 seconds both
// turn the current time into the same 6-digit code. A stolen password alone
// is then not enough to log in to the console (D52).

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32, RFC 4648

// Authenticator apps expect the secret in base32.
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// A new secret: 20 random bytes, the size RFC 4226 recommends for HMAC-SHA1.
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// Which 30-second step a moment falls in.
export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

// The code for one step (RFC 4226, section 5.3): HMAC-SHA1 of the step
// number, then 4 bytes picked by the last nibble, as a 6-digit number.
export function codeForStep(secret: Buffer, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", secret).update(counter).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(number).padStart(digits, "0");
}

// Returns the step the code belongs to, or null if it is wrong. The step
// before and after are accepted too, because a phone's clock can be a few
// seconds off. A step at or before lastUsedStep is refused, so a code seen
// over someone's shoulder cannot be used a second time.
export function checkTotp(secretBase32: string, code: string, nowMs: number, lastUsedStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = totpStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(codeForStep(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

// The link an authenticator app reads (usually from a QR code) to add the account.
export function otpauthUri(email: string, secretBase32: string): string {
  const label = encodeURIComponent(`Novi console:${email}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent("Novi console")}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
