import { randomInt, randomUUID } from "node:crypto";
import type {
  ConfirmVerificationResult,
  IdentityDetails,
  IdentityProvider,
  StartVerificationResult,
} from "./IdentityProvider.js";

// A record in the fake register. NIU values are invented for the demo
// and do not follow ANID's real format.
type AnidRecord = { niu: string; fullName: string; dateOfBirth: string; phone: string };

type PendingVerification = { code: string; expiresAt: number; attemptsLeft: number };

const CODE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 3;

// Demo identity register. 1 January is a common recorded date
// when a person's exact date of birth is unknown.
const DEMO_REGISTER: AnidRecord[] = [
  { niu: "TEST-0001", fullName: "AKOSSIWA AFI MENSAH", dateOfBirth: "1984-03-12", phone: "+22890000001" },
  { niu: "TEST-0002", fullName: "ABLA DZIFA AGBEKO", dateOfBirth: "1990-07-25", phone: "+22890000002" },
  { niu: "TEST-0003", fullName: "KOFFI SELOM AMEGAH", dateOfBirth: "1979-01-01", phone: "+22890000003" },
];

// Compares names ignoring capitals and extra spaces; accents and the order
// of names must match exactly (D12).
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

// Shows only the last four digits, so the member knows which phone
// receives the code without the full number being revealed.
function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)} ** ** ${phone.slice(-4, -2)} ${phone.slice(-2)}`;
}

// Stands in for ANID during the demo. Holds pending codes in memory,
// so they are lost if the API restarts.
export class MockAnidProvider implements IdentityProvider {
  // Codes "sent" by the mock, readable by tests. A real service never exposes them.
  readonly sentCodes = new Map<string, string>();
  private readonly pending = new Map<string, PendingVerification>();

  async startVerification(details: IdentityDetails): Promise<StartVerificationResult> {
    const record = DEMO_REGISTER.find(
      (r) =>
        r.niu === details.niu.trim() &&
        normalizeName(r.fullName) === normalizeName(details.fullName) &&
        r.dateOfBirth === details.dateOfBirth,
    );
    if (!record) return { kind: "NO_MATCH" };

    const transactionId = randomUUID();
    // A cryptographically secure random number, padded to 6 digits.
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.pending.set(transactionId, {
      code,
      expiresAt: Date.now() + CODE_LIFETIME_MS,
      attemptsLeft: MAX_CODE_ATTEMPTS,
    });
    this.sentCodes.set(transactionId, code);
    console.log(`[mock ANID] code ${code} sent to ${record.phone}`);

    return { kind: "CODE_SENT", transactionId, maskedPhone: maskPhone(record.phone) };
  }

  async confirmVerification(transactionId: string, code: string): Promise<ConfirmVerificationResult> {
    const pending = this.pending.get(transactionId);
    if (!pending || Date.now() > pending.expiresAt) {
      this.pending.delete(transactionId);
      return { kind: "EXPIRED" };
    }

    if (code !== pending.code) {
      pending.attemptsLeft -= 1;
      if (pending.attemptsLeft === 0) {
        this.pending.delete(transactionId);
        return { kind: "EXPIRED" };
      }
      return { kind: "CODE_INVALID", attemptsLeft: pending.attemptsLeft };
    }

    this.pending.delete(transactionId);
    return { kind: "VERIFIED" };
  }
}