// Verifies that a person owns a national identity record (NIU), in two steps
// as MOSIP-based services do: first match the details, then confirm a one-time
// code sent to the phone on the identity record (D12).

export type IdentityDetails = {
  niu: string;
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
};

export type StartVerificationResult =
  | { kind: "CODE_SENT"; transactionId: string; maskedPhone: string }
  | { kind: "NO_MATCH" };

export type ConfirmVerificationResult =
  | { kind: "VERIFIED" }
  | { kind: "CODE_INVALID"; attemptsLeft: number }
  | { kind: "EXPIRED" };

export interface IdentityProvider {
  startVerification(details: IdentityDetails): Promise<StartVerificationResult>;
  confirmVerification(transactionId: string, code: string): Promise<ConfirmVerificationResult>;
}