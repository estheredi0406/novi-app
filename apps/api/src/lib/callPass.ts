import { createHmac, timingSafeEqual } from "node:crypto";

// D112: a member's signed pass to one call room (who she is, the room, when it
// opens and closes). Knowing the room's address alone lets nobody in.
export type CallPass = {
  room: string;
  uid: string;
  name: string;
  owner: boolean;
  max: number;
  nbf: number; // seconds: the room opens
  exp: number; // seconds: the room closes, and everyone in it is let go
  lang: "fr" | "en";
};

function secret(): string {
  const value = process.env.CALL_SECRET ?? process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET (or CALL_SECRET) is needed to sign call passes.");
  return value;
}

const sign = (body: string) => createHmac("sha256", secret()).update(`call:${body}`).digest("base64url");

export function signPass(pass: CallPass): string {
  const body = Buffer.from(JSON.stringify(pass)).toString("base64url");
  return `${body}.${sign(body)}`;
}

// The pass, if its signature is right and the room is open now; else null.
export function readPass(token: string, now = Date.now()): CallPass | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const pass = JSON.parse(Buffer.from(body, "base64url").toString()) as CallPass;
    const seconds = Math.floor(now / 1000);
    if (seconds < pass.nbf || seconds >= pass.exp) return null;
    return pass;
  } catch {
    return null;
  }
}
