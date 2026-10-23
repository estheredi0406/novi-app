import { Router } from "express";
import { z } from "zod";
import { currentStaff, requireStaff } from "../middleware/requireStaff.js";
import { getConsoleGroup, getOverview, listAttention, listConsoleGroups, retryPayout } from "../services/consoleService.js";
import { listSharedWithMfi, openSharedRecord } from "../services/recordService.js";

// The MFI console's data (Sprint 5.2). Staff only; every answer is limited
// to the officer's own MFI (D52).
export const consoleRouter = Router();
consoleRouter.use(requireStaff);

const id = z.string().uuid();

consoleRouter.get("/overview", async (_req, res) => {
  res.status(200).json(await getOverview(currentStaff(res).mfiId));
});

consoleRouter.get("/groups", async (_req, res) => {
  res.status(200).json(await listConsoleGroups(currentStaff(res).mfiId));
});

consoleRouter.get("/groups/:groupId", async (req, res) => {
  res.status(200).json(await getConsoleGroup(currentStaff(res).mfiId, id.parse(req.params.groupId)));
});

consoleRouter.get("/attention", async (_req, res) => {
  res.status(200).json(await listAttention(currentStaff(res).mfiId));
});

consoleRouter.post("/payouts/:payoutId/retry", async (req, res) => {
  const staff = currentStaff(res);
  res.status(200).json(await retryPayout(staff.mfiId, staff.staffId, id.parse(req.params.payoutId)));
});

// Savings records members shared with this MFI by name (D54). Opening one is
// logged with the officer's name, and she sees that it was opened.
consoleRouter.get("/records", async (_req, res) => {
  res.status(200).json(await listSharedWithMfi(currentStaff(res).mfiId));
});

consoleRouter.get("/records/:shareId", async (req, res) => {
  const { staffId, mfiId } = currentStaff(res);
  res.status(200).json(await openSharedRecord({ staffId, mfiId }, id.parse(req.params.shareId)));
});
