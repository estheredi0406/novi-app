import type { ErrorCode } from "@novi/shared";

// An expected failure with a known code, such as a wrong SMS code. Thrown
// anywhere in the API and turned into a standard response by errorHandler.
// An expected failure with a known code, such as a wrong SMS code. Thrown
// anywhere in the API and turned into a standard response by errorHandler.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfterSec?: number,
    readonly challengeId?: string,
  ) {
    super(code);
  }
}