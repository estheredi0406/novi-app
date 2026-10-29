import { Router } from "express";
import { MemoryStore, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { currentStaff, requireStaff } from "../middleware/requireStaff.js";
import { changePassword, getStaffProfile, staffLogin, staffLogout } from "../services/staffService.js";

// The MFI console's login (Sprint 5, D52).
export const staffRouter = Router();

// Per-address limit on login attempts, on top of the per-account lockout.
export const staffLoginStore = new MemoryStore();
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: staffLoginStore,
  handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", 429, 15 * 60)),
});

const loginBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  code: z.string().regex(/^\d{6}$/),
});

staffRouter.post("/login", loginLimit, async (req, res) => {
  res.status(200).json(await staffLogin(loginBody.parse(req.body)));
});

staffRouter.post("/logout", requireStaff, async (_req, res) => {
  await staffLogout(currentStaff(res).sessionId);
  res.status(204).end();
});

staffRouter.get("/me", requireStaff, async (_req, res) => {
  res.status(200).json(await getStaffProfile(currentStaff(res).staffId));
});

// D81: her own password, required at the first login.
const passwordBody = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).strict();

staffRouter.post("/password", requireStaff, async (req, res) => {
  const { staffId, sessionId } = currentStaff(res);
  const { current, next } = passwordBody.parse(req.body);
  res.status(200).json(await changePassword(staffId, sessionId, current, next));
});
