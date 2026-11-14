import { createHash, createHmac, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { config } from "./config.js";

// PINs and SMS codes are hashed with argon2id, which is slow on purpose, so a
// leaked database cannot be brute-forced. Tests use a lighter cost so a laptop
// does not run out of memory; production keeps the default.
const TEST_COST = { memoryCost: 4096, timeCost: 2, parallelism: 1 };

export async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, {
    type: argon2.argon2id,
    ...(process.env.NODE_ENV === "test" ? TEST_COST : {}),
  });
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  return argon2.verify(hash, secret);
}

// A new refresh token: 32 random bytes, far too many possibilities to guess.
export function newRandomToken(): string {
  return randomBytes(32).toString("base64url");
}

// Long random tokens only need a fast hash. Without a salt, the same token
// always gives the same hash, so a session can be found by it (D14).
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Keyed hash of an NIU: detects a second account for the same person without
// storing the NIU. Without the server's key, it cannot be reversed by trying
// every possible number.
export function niuKeyedHash(niu: string): string {
  return createHmac("sha256", config.niuHashKey).update(niu.trim().toUpperCase()).digest("hex");
}