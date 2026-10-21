import { Router } from "express";
import { z } from "zod";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import { checkContribution } from "../services/moneyService.js";

// Her own payments.
export const contributionsRouter = Router();

contributionsRouter.use(requireAuth);

const params = z.object({ id: z.string().uuid() });

// "Check my payment": asks the provider directly, in case its webhook was lost.
contributionsRouter.post("/:id/check", async (req, res) => {
  const { id } = params.parse(req.params);
  res.json(await checkContribution(id, currentMember(res).userId));
});
