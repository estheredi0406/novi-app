import { Router } from "express";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import { listMyInvitations } from "../services/groupService.js";

// Invitations addressed to the logged-in member's phone number.
export const invitationsRouter = Router();

invitationsRouter.use(requireAuth);

invitationsRouter.get("/", async (_req, res) => {
  res.json(await listMyInvitations(currentMember(res).userId));
});