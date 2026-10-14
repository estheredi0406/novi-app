import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { requestOtp, verifyOtp } from "../services/otpService.js";

export const authRouter = Router();

// A Togolese mobile number: +228 followed by 8 digits.
const phone = z.string().regex(/^\+228\d{8}$/);

const otpRequestBody = z.object({
  phone,
  purpose: z.enum(["SIGN_UP", "PIN_RESET"]),
  language: z.enum(["EN", "FR", "EE"]),
});

const otpVerifyBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

// Limits code requests per internet address, so one device cannot make Novi
// send SMS to thousands of numbers. Per-phone limits live in otpService.
const otpRequestsPerAddress = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError("OTP_RATE_LIMITED", 429, 3600)),
});

authRouter.post("/otp", otpRequestsPerAddress, async (req, res) => {
  const input = otpRequestBody.parse(req.body);
  res.status(201).json(await requestOtp(input));
});

authRouter.post("/otp/verify", async (req, res) => {
  const input = otpVerifyBody.parse(req.body);
  res.status(200).json(await verifyOtp(input));
});