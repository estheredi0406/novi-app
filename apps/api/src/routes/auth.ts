import { Router } from "express";
import { MemoryStore, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import { login, register, resetPin, trustDevice } from "../services/authService.js";
import { confirmIdentityCheck, startIdentityCheck } from "../services/identityService.js";
import { requestOtp, verifyOtp } from "../services/otpService.js";
import { logout, refreshSession } from "../services/sessionService.js";

export const authRouter = Router();

// A Togolese mobile number: +228 followed by 8 digits.
const phone = z.string().regex(/^\+228\d{8}$/);
const pin = z.string().regex(/^\d{4}$/);

// Each per-address limit keeps its counts in memory; tests reset them so
// that every test starts from a clean state.
const addressStores: MemoryStore[] = [];

export function resetAddressLimits(): void {
  for (const store of addressStores) store.resetAll();
}

// Builds a limit on requests per internet address. Per-phone and per-account
// limits live in the services; these stop one device from targeting many people.
function perAddress(limit: number, windowMin: number, code: "OTP_RATE_LIMITED" | "ID_BLOCKED" | "RATE_LIMITED") {
  const store = new MemoryStore();
  addressStores.push(store);
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store,
    handler: (_req, _res, next) => next(new AppError(code, 429, windowMin * 60)),
  });
}

// ---------- SMS codes ----------

const otpRequestBody = z.object({
  phone,
  purpose: z.enum(["SIGN_UP", "PIN_RESET"]),
  language: z.enum(["EN", "FR", "EE"]),
});

const otpVerifyBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

authRouter.post("/otp", perAddress(20, 60, "OTP_RATE_LIMITED"), async (req, res) => {
  res.status(201).json(await requestOtp(otpRequestBody.parse(req.body)));
});

authRouter.post("/otp/verify", async (req, res) => {
  res.status(200).json(await verifyOtp(otpVerifyBody.parse(req.body)));
});

// ---------- Identity check ----------

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

authRouter.post("/identity/start", perAddress(20, 60, "ID_BLOCKED"), async (req, res) => {
  res.status(200).json(await startIdentityCheck(identityStartBody.parse(req.body)));
});

authRouter.post("/identity/confirm", async (req, res) => {
  res.status(200).json(await confirmIdentityCheck(identityConfirmBody.parse(req.body)));
});

// ---------- Account creation ----------

const registerBody = z.object({
  verificationToken: z.string().min(1),
  identityToken: z.string().min(1),
  pin,
  displayName: z.string().trim().min(1).max(60),
  area: z.string().trim().min(2).max(60),
  market: z.string().trim().min(2).max(60).nullable().optional(),
  language: z.enum(["EN", "FR", "EE"]),
  installationId: z.string().uuid(),
  acceptedTerms: z.boolean(),
  acceptedCreditDataUse: z.boolean(),
});

authRouter.post("/register", async (req, res) => {
  res.status(201).json(await register(registerBody.parse(req.body)));
});

// ---------- Login and new phones ----------

const loginBody = z.object({ phone, pin, installationId: z.string().uuid() });

const trustBody = z.object({
  verificationToken: z.string().min(1),
  pin,
  installationId: z.string().uuid(),
});

authRouter.post("/login", perAddress(30, 15, "RATE_LIMITED"), async (req, res) => {
  res.status(200).json(await login(loginBody.parse(req.body)));
});

authRouter.post("/devices/trust", async (req, res) => {
  res.status(200).json(await trustDevice(trustBody.parse(req.body)));
});

// ---------- Staying logged in ----------

const refreshBody = z.object({ refreshToken: z.string().min(1) });

authRouter.post("/refresh", async (req, res) => {
  res.status(200).json(await refreshSession(refreshBody.parse(req.body).refreshToken));
});

// Only the logged-in member can end her own session.
authRouter.post("/logout", requireAuth, async (_req, res) => {
  const { userId, sessionId } = currentMember(res);
  await logout(userId, sessionId);
  res.status(204).end();
});

// ---------- Forgotten PIN ----------

const pinResetBody = z.object({ verificationToken: z.string().min(1), newPin: pin });

authRouter.post("/pin/reset", async (req, res) => {
  await resetPin(pinResetBody.parse(req.body));
  res.status(204).end();
});