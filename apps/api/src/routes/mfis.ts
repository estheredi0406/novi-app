import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { listPartnerMfis } from "../services/groupService.js";

// D95: the MFIs a group can choose to keep its money, for the group form.
export const mfisRouter = Router();

mfisRouter.use(requireAuth);

mfisRouter.get("/", async (_req, res) => {
  res.json(await listPartnerMfis());
});
