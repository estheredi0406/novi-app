import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";

// Signs shared savings records with Ed25519 (D50). The private key stays on
// the server; the public key is published, so a lender's systems can check a
// record without asking Novi. Changing one character of a signed record
// makes the signature fail.
//
// The key is read from ACEV_PRIVATE_KEY in .env: an Ed25519 private key in
// PKCS#8 DER form, base64. Generate one with:
//   node -e "const {generateKeyPairSync}=require('crypto');console.log(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))"
// Tests use a fresh key made at start, so no real key is ever needed in them.

let privateKey: KeyObject | null = null;

function signingKey(): KeyObject {
  if (privateKey) return privateKey;
  const fromEnv = process.env.ACEV_PRIVATE_KEY;
  if (fromEnv) {
    privateKey = createPrivateKey({ key: Buffer.from(fromEnv, "base64"), format: "der", type: "pkcs8" });
  } else if (process.env.NODE_ENV === "test") {
    privateKey = generateKeyPairSync("ed25519").privateKey;
  } else {
    throw new Error("ACEV_PRIVATE_KEY is not set. See apps/api/src/lib/recordSigning.ts to generate one.");
  }
  return privateKey;
}

export function signRecord(text: string): string {
  return sign(null, Buffer.from(text, "utf8"), signingKey()).toString("base64url");
}

export function verifyRecord(text: string, signature: string): boolean {
  return verify(null, Buffer.from(text, "utf8"), createPublicKey(signingKey()), Buffer.from(signature, "base64url"));
}

// The public half, in the standard PEM form other systems read.
export function publicKeyPem(): string {
  return createPublicKey(signingKey()).export({ type: "spki", format: "pem" }).toString();
}
