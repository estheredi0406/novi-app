// Verifies that a person owns a national identity record (NIU), in two steps
// as MOSIP-based services do: first match the details, then confirm a one-time
// code sent to the phone on the identity record (D12).

// D106: on a basic phone, typing a full legal name on the keypad is slow and
// error-prone, so the USSD sign-up gives only the NIU and date of birth; the
// register returns the name after its code is confirmed (the "e-KYC" pattern
// of MOSIP-based registers), and she then confirms it is hers.
export type IdentityDetails = {
  niu: string;
  firstName?: string; // D132: the app's sign-up sends both names apart
  lastName?: string;
  fullName?: string; // an older app sends one full name; USSD leaves names out
  dateOfBirth: string; // YYYY-MM-DD
};

export type StartVerificationResult =
  | { kind: "CODE_SENT"; transactionId: string; maskedPhone: string }
  | { kind: "NO_MATCH" };

export type ConfirmVerificationResult =
  | { kind: "VERIFIED"; fullName: string } // the name on the record
  | { kind: "CODE_INVALID"; attemptsLeft: number }
  | { kind: "EXPIRED" };

export interface IdentityProvider {
  startVerification(details: IdentityDetails): Promise<StartVerificationResult>;
  confirmVerification(transactionId: string, code: string): Promise<ConfirmVerificationResult>;
}