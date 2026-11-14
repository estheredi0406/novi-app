import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign, verify } from "node:crypto";

// Signs shared records with Ed25519 (D50). The private key stays on the server;
// the public key lets a lender check a record. Change one character and the
// signature fails. The key comes from ACEV_PRIVATE_KEY; to make one:
//   node -e "const {generateKeyPairSync}=require('crypto');console.log(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))"

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
