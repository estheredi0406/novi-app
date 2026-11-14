import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// D101: secrets we must read back (an officer's authenticator key) are stored
// encrypted with AES-256-GCM, so a copy of the database is not enough to log in.
// The key comes from SECRET_BOX_KEY (or a hash of JWT_SECRET). Changing it means
// officers need new authenticator keys.
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
