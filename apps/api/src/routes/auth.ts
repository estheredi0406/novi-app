import { Router } from "express";
import { confirmIdentityCheck, startIdentityCheck } from "../services/identityService.js";
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

const identityStartBody = z.object({
  verificationToken: z.string().min(1),
  consentToIdCheck: z.boolean(),
  niu: z.string().trim().min(1).max(40),
  legalName: z.string().trim().min(2).max(120),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const identityConfirmBody = z.object({
  verificationToken: z.string().min(1),
  pendingToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

// Limits identity checks per internet address, so one device cannot try
// many people's details. Per-NIU limits live in identityService.
const identityChecksPerAddress = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError("ID_BLOCKED", 429, 3600)),
});

authRouter.post("/identity/start", identityChecksPerAddress, async (req, res) => {
  const input = identityStartBody.parse(req.body);
  res.status(200).json(await startIdentityCheck(input));
});

authRouter.post("/identity/confirm", async (req, res) => {
  const input = identityConfirmBody.parse(req.body);
  res.status(200).json(await confirmIdentityCheck(input));
});