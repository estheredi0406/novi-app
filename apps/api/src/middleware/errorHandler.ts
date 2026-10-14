import { type ApiError, errors } from "@novi/shared";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

// Turns every error into the standard error body from @novi/shared. The app
// shows the message for messageKey in the member's language.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiError = {
      error: { code: err.code, messageKey: errors[err.code].messageKey, retryAfterSec: err.retryAfterSec },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiError = {
      error: { code: "VALIDATION_FAILED", messageKey: errors.VALIDATION_FAILED.messageKey },
    };
    res.status(400).json(body);
    return;
  }

  // Unexpected failure: details go to the server log, never to the phone.
  console.error("Unexpected error", err);
  const body: ApiError = { error: { code: "INTERNAL", messageKey: errors.INTERNAL.messageKey } };
  res.status(500).json(body);
};