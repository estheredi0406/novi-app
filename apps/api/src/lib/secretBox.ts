import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// D101: secrets Novi must read back (an officer's authenticator key) are kept
// encrypted in the database, not as plain text. A copy of the database alone
// then gives nobody the keys to log in as an MFI officer: the key to open them
// lives only in the server's settings. AES-256-GCM, which also detects any
// change to the stored value.
//
// The key comes from SECRET_BOX_KEY, or, if it is not set, from JWT_SECRET
// (hashed, so the two are never the same value). Changing it makes the stored
// authenticator keys unreadable: officers would then need new ones.
const PREFIX = "v1:";

function key(): Buffer {
  const value = process.env.SECRET_BOX_KEY ?? process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET (or SECRET_BOX_KEY) is needed to protect stored secrets.");
  return createHash("sha256").update(`secret-box:${value}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// A value written before D101 is still plain text: it is returned as it is,
// and sealed the next time its owner logs in.
export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function open(stored: string): string {
  if (!isSealed(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
