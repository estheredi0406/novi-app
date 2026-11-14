import type { ErrorCode } from "@novi/shared";

// An expected failure with a known code (for example a wrong SMS code), turned
// into a normal error response by errorHandler.
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    readonly retryAfterSec?: number,
    readonly challengeId?: string,
    readonly pilotCode?: string, // pilot mode only (D61)
  ) {
    super(code);
  }
}