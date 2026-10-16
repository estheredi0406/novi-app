import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

// What she has entered and proved so far during sign-up. Kept in memory only,
// never saved to the phone: the stamps expire within minutes, and the PIN
// must never be written to storage. Closing the app restarts sign-up.
export type SignUpDraft = {
  phone?: string;
  challengeId?: string;
  resendInSec?: number;
  verificationToken?: string;
  consentToIdCheck?: boolean;
  acceptedCreditDataUse?: boolean;
  acceptedTerms?: boolean;
  pendingToken?: string;
  maskedPhone?: string;
  identityToken?: string;
  legalName?: string;
  pin?: string;
};

type SignUp = {
  draft: SignUpDraft;
  update: (changes: Partial<SignUpDraft>) => void;
  reset: () => void;
};

const SignUpContext = createContext<SignUp | null>(null);

export function SignUpProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SignUpDraft>({});
  const update = useCallback((changes: Partial<SignUpDraft>) => setDraft((current) => ({ ...current, ...changes })), []);
  const reset = useCallback(() => setDraft({}), []);
  return <SignUpContext.Provider value={{ draft, update, reset }}>{children}</SignUpContext.Provider>;
}

export function useSignUp(): SignUp {
  const signUp = useContext(SignUpContext);
  if (!signUp) throw new Error("useSignUp must be used inside SignUpProvider");
  return signUp;
}