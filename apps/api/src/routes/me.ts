import { Router } from "express";
import { z } from "zod";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import { getProfile, updateProfile } from "../services/memberService.js";

export const meRouter = Router();

// Every route in this file belongs to the member making the request.
meRouter.use(requireAuth);

// Only these fields may be sent. .strict() refuses anything else, so an
// attempt to change the legal name is rejected, not silently ignored.
const profileChanges = z
  .object({
    displayName: z.string().trim().min(1).max(60).optional(),
    area: z.string().trim().min(2).max(60).optional(),
    market: z.string().trim().min(2).max(60).nullable().optional(),
    language: z.enum(["EN", "FR", "EE"]).optional(),
  })
  .strict();

meRouter.get("/", async (_req, res) => {
  res.json(await getProfile(currentMember(res).userId));
});

meRouter.patch("/", async (req, res) => {
  const changes = profileChanges.parse(req.body);
  res.json(await updateProfile(currentMember(res).userId, changes));
});