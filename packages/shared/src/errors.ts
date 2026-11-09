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
  RATE_LIMITED: { messageKey: "errors.rateLimited" },

  // Group rules (apps/api/src/lib/groupRules.ts). The codes match the
  // rules engine's reasons one to one.
  NOT_ALLOWED_NOW: { messageKey: "groups.notAllowedNow" },
  DEBT_OUTSTANDING: { messageKey: "groups.debtOutstanding" }, // D69: a covered share not yet repaid
  ACCOUNT_CLOSED: { messageKey: "auth.accountClosed" }, // D69: recorded deceased by the MFI
  NEXT_OF_KIN_MISSING: { messageKey: "errors.nextOfKinMissing" }, // D69: console, no number to pay after a death
  NEXT_OF_KIN_SELF: { messageKey: "kin.notYours" },
  MEETING_TIME_INVALID: { messageKey: "meetings.timeInvalid" }, // D71: in the past, too far ahead, or overlapping
  MEETING_LIMIT: { messageKey: "meetings.limit" }, // D71: too many meetings already planned
  MEETING_NOT_OPEN: { messageKey: "meetings.notOpen" }, // D71: the room opens 10 minutes before
  VOICE_EXPIRED: { messageKey: "chat.voiceExpired" }, // the voice note was deleted (hidden, or the cycle ended)
  MEETING_UNAVAILABLE: { messageKey: "meetings.unavailable" }, // D71: the video provider did not answer // D69: her own number cannot be her next of kin's
  ORGANISER_ONLY: { messageKey: "groups.organiserOnly" },
  MEMBERS_ONLY: { messageKey: "groups.membersOnly" },
  SIZE_OUT_OF_RANGE: { messageKey: "groups.sizeOutOfRange" },
  AMOUNT_OUT_OF_RANGE: { messageKey: "groups.amountOutOfRange" },
  DUE_DAY_OUT_OF_RANGE: { messageKey: "groups.dueDayOutOfRange" },
  GROUP_FULL: { messageKey: "groups.full" },
  GROUP_LIMIT_REACHED: { messageKey: "groups.limitReached" },
  MFI_UNKNOWN: { messageKey: "groups.mfiUnknown" },
  START_LIMIT_REACHED: { messageKey: "groups.startLimitReached" },
  SEATS_NOT_FILLED: { messageKey: "groups.seatsNotFilled" },
  NOT_EVERYONE_ACCEPTED: { messageKey: "groups.notEveryoneAccepted" },
  RULES_CHANGED: { messageKey: "groups.rulesChanged" },
  ORDER_INVALID: { messageKey: "groups.orderInvalid" },
  MFI_UNAVAILABLE: { messageKey: "groups.mfiUnavailable" },

  // Help inside the group and credit (D87, D88, D89)
  SWAP_NOT_POSSIBLE: { messageKey: "help.swapNotPossible" }, // a turn already paid out, due today, or a swap already open
  ADVANCE_NOT_ALLOWED: { messageKey: "help.advanceNotAllowed" }, // late payments, pot already received, or an advance already open
  ADVANCE_TOO_LARGE: { messageKey: "help.advanceTooLarge" }, // more than one contribution
  FUND_TOO_LOW: { messageKey: "help.fundTooLow" }, // the solidarity fund cannot spare it now
  LOAN_NOT_ELIGIBLE: { messageKey: "loan.notEligible" },
  LOAN_TOO_LARGE: { messageKey: "loan.tooLarge" },
  DOCUMENT_INVALID: { messageKey: "loan.documentInvalid" }, // D91: not a photo, or too large
  DOCUMENTS_CONSENT_REQUIRED: { messageKey: "loan.documentsConsentRequired" },

  // Money in (Sprint 3)
  ROUND_NOT_OPEN: { messageKey: "money.roundNotOpen" },
  ALREADY_PAID: { messageKey: "money.alreadyPaid" },
  // D104: "Je ne peux pas payer ce tour"
  SKIP_NOT_THIS_ROUND: { messageKey: "skip.notThisRound" },
  SKIP_OWN_TURN: { messageKey: "skip.ownTurn" },
  SKIP_OWES_COVER: { messageKey: "skip.owesCover" },
  SKIP_LIMIT: { messageKey: "skip.limit" },
  SKIP_TWICE_IN_A_ROW: { messageKey: "skip.twiceInARow" },
  SKIP_NO_ADVANCES: { messageKey: "skip.noAdvances" },
  COVER_ALREADY_EXTENDED: { messageKey: "skip.alreadyExtended" },
  TURN_ONE_NEEDS_HISTORY: { messageKey: "groups.turnOneNeedsHistory" },
  PAYMENT_IN_PROGRESS: { messageKey: "money.paymentInProgress" },
  PAYMENT_REPORTED: { messageKey: "money.paymentReported" }, // D105: the MFI is checking it
  MFI_PAYMENTS_NOT_CONNECTED: { messageKey: "money.mfiNotConnected" }, // D102: the MFI has no payment account yet
  PAYMENT_ACCOUNT_REFUSED: { messageKey: "staff.paymentAccountRefused" }, // D102: FedaPay refused the key
  PAYMENT_UNAVAILABLE: { messageKey: "money.paymentUnavailable" },
  WEBHOOK_INVALID: { messageKey: "errors.validationFailed" },

  // Invitations
  ALREADY_INVITED: { messageKey: "groups.alreadyInvited" },
  CANNOT_REMOVE_ORGANISER: { messageKey: "groups.cannotRemoveOrganiser" },

  // MFI console (Sprint 5). One code for any wrong email, password or
  // authenticator code, so a failed login never says which part was wrong.
  STAFF_LOGIN_FAILED: { messageKey: "staff.loginFailed" },
  STAFF_LOCKED: { messageKey: "staff.locked" },
  STAFF_ONLY: { messageKey: "staff.staffOnly" },
  PASSWORD_CHANGE_REQUIRED: { messageKey: "staff.passwordChangeRequired" }, // D81: first login, temporary password
  ADMIN_ONLY: { messageKey: "staff.adminOnly" }, // D81: managing the team
  SECOND_OFFICER_NEEDED: { messageKey: "staff.secondOfficer" }, // D105: two officers for a large pot
  STAFF_EMAIL_TAKEN: { messageKey: "staff.emailTaken" }, // D81
  WEAK_PASSWORD: { messageKey: "staff.weakPassword" }, // D81: at least 12 characters, not the temporary one
} as const;

// The allowed error codes, derived from the list above so the two never drift apart.
export type ErrorCode = keyof typeof errors;

// The shape of every error response body.
export type ApiError = {
  error: {
    code: ErrorCode;
    messageKey: string;
    retryAfterSec?: number; // when the member may try again, for lockouts and limits
    challengeId?: string; // with NEW_DEVICE: the SMS code to verify on this phone
    pilotCode?: string; // pilot mode only (D61)
  };
};
