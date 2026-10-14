// Every error the API can return. The API sends the code; the app shows the
// message for messageKey in the member's language. The server never sends sentences.
export const errors = {
  VALIDATION_FAILED: { messageKey: "errors.validationFailed" },
  UNAUTHENTICATED: { messageKey: "errors.unauthenticated" },
  NOT_FOUND: { messageKey: "errors.notFound" },
  INTERNAL: { messageKey: "errors.internal" },

  OTP_INVALID: { messageKey: "auth.otpInvalid" },
  OTP_EXPIRED: { messageKey: "auth.otpExpired" },
  OTP_TOO_MANY_ATTEMPTS: { messageKey: "auth.otpTooManyAttempts" },
  OTP_RATE_LIMITED: { messageKey: "auth.otpRateLimited" },

  PHONE_ALREADY_REGISTERED: { messageKey: "auth.phoneAlreadyRegistered" },
  PIN_INVALID: { messageKey: "auth.pinInvalid" },
  PIN_LOCKED: { messageKey: "auth.pinLocked" },
  PIN_TOO_WEAK: { messageKey: "auth.pinTooWeak" },
  NEW_DEVICE: { messageKey: "auth.newDevice" },
  SESSION_REVOKED: { messageKey: "auth.sessionRevoked" },

  ID_MISMATCH: { messageKey: "identity.mismatch" },
  ID_BLOCKED: { messageKey: "identity.blocked" },
  NIU_ALREADY_REGISTERED: { messageKey: "identity.niuAlreadyRegistered" },
  CONSENT_REQUIRED: { messageKey: "auth.consentRequired" },
  ID_CODE_INVALID: { messageKey: "identity.codeInvalid" },
  ID_CODE_EXPIRED: { messageKey: "identity.codeExpired" },
} as const;



// The allowed error codes, derived from the list above so the two never drift apart.
export type ErrorCode = keyof typeof errors;

// The shape of every error response body.
export type ApiError = {
  error: {
    code: ErrorCode;
    messageKey: string;
    retryAfterSec?: number; // when the member may try again, for lockouts and limits
  };
};