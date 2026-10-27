import "dotenv/config";

// Sandbox diagnosis only: finds which FedaPay "send now" call this sandbox
// account accepts for its published test numbers (Benin, MTN 66000001 and
// Moov 64000001). It creates one small transaction per attempt and prints
// FedaPay's answer, never the key. Run from apps/api:
//
//   npm run fedapay:probe
//
// It reads FEDAPAY_SECRET_KEY from .env, like the API.

const BASE = "https://sandbox-api.fedapay.com/v1";
const key = process.env.FEDAPAY_SECRET_KEY;

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  // The full answer is kept for reading it; only what is printed is cut short.
  return { status: res.status, text, short: text.slice(0, 300) };
}

// A fresh transaction and token for one attempt, with a Benin customer.
async function newToken(number: string): Promise<{ id: number; token: string } | null> {
  const created = await call("POST", "/transactions", {
    description: "Novi sandbox probe",
    amount: 500,
    currency: { iso: "XOF" },
    customer: {
      firstname: "Probe",
      lastname: "Novi",
      email: `probe-${Date.now()}@novi.invalid`,
      phone_number: { number, country: "bj" },
    },
  });
  if (created.status >= 300) {
    console.log(`  create transaction: ${created.status} ${created.short}`);
    return null;
  }
  const id = (JSON.parse(created.text)["v1/transaction"] as { id: number }).id;
  const tokened = await call("POST", `/transactions/${id}/token`);
  if (tokened.status >= 300) {
    console.log(`  token: ${tokened.status} ${tokened.short}`);
    return null;
  }
  return { id, token: (JSON.parse(tokened.text) as { token: string }).token };
}

async function main() {
  if (!key?.startsWith("sk_sandbox")) throw new Error("FEDAPAY_SECRET_KEY must be a sandbox key (sk_sandbox_...).");

  // Benin moved to 10-digit numbers ("01" + the old 8 digits) in 2024, so
  // both forms are tried.
  const numbers = ["64000001", "0164000001", "66000001", "0166000001"];
  const paths = (mode: string) => [`/${mode}`, `/transactions/${mode}`];
  const modes = ["moov", "moov_benin", "mtn", "mtn_benin", "mtn_open"];

  for (const number of numbers) {
    for (const mode of modes) {
      // Moov numbers with Moov modes, MTN numbers with MTN modes.
      const moovNumber = number.endsWith("64000001");
      if (moovNumber !== mode.startsWith("moov")) continue;
      for (const path of paths(mode)) {
        const tx = await newToken(number);
        if (!tx) return;
        const sent = await call("POST", path, { token: tx.token, phone_number: { number, country: "bj" } });
        await new Promise((r) => setTimeout(r, 3000));
        const status = await call("GET", `/transactions/${tx.id}`);
        const state = status.status < 300 ? (JSON.parse(status.text)["v1/transaction"] as { status: string }).status : "?";
        console.log(`${number} ${path}: ${sent.status} ${sent.short.replace(/\s+/g, " ")} → transaction ${state}`);
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
