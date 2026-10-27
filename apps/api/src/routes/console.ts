import { Router } from "express";
import { z } from "zod";
import { currentStaff, requireStaff } from "../middleware/requireStaff.js";
import {
  getConsoleGroup,
  getOverview,
  listAttention,
  listConsoleGroups,
  approveGroup,
  declineGroup,
  getAnalytics,
  listActivity,
  releaseRoundPayout,
  retryPayout,
} from "../services/consoleService.js";
import { listSharedWithMfi, openSharedRecord } from "../services/recordService.js";
import { documentFor } from "./verify.js";

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

// D66: a started group waits for the officer's approval before its account opens.
consoleRouter.post("/groups/:groupId/approve", async (req, res) => {
  const staff = currentStaff(res);
  res.status(200).json(await approveGroup(staff.mfiId, staff.staffId, id.parse(req.params.groupId)));
});

consoleRouter.post("/groups/:groupId/decline", async (req, res) => {
  const staff = currentStaff(res);
  const { reason } = z
    .object({ reason: z.string().trim().min(3).max(300) })
    .strict()
    .parse(req.body);
  res.status(200).json(await declineGroup(staff.mfiId, staff.staffId, id.parse(req.params.groupId), reason));
});

// D67: the portfolio over time, and what the officers did.
consoleRouter.get("/analytics", async (_req, res) => {
  res.status(200).json(await getAnalytics(currentStaff(res).mfiId));
});

consoleRouter.get("/activity", async (_req, res) => {
  res.status(200).json(await listActivity(currentStaff(res).mfiId));
});

// D63: a full, due pot leaves only when the officer releases it.
consoleRouter.post("/payouts/:payoutId/release", async (req, res) => {
  const staff = currentStaff(res);
  res.status(200).json(await releaseRoundPayout(staff.mfiId, staff.staffId, id.parse(req.params.payoutId)));
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

// The same record as the ACEV document (D65), for the console to show.
consoleRouter.get("/records/:shareId/document", async (req, res) => {
  const { staffId, mfiId } = currentStaff(res);
  const shareId = id.parse(req.params.shareId);
  const check = await openSharedRecord({ staffId, mfiId }, shareId);
  res.type("html").send(await documentFor(check, shareId, `${req.protocol}://${req.get("host")}`));
});

consoleRouter.get("/records/:shareId", async (req, res) => {
  const { staffId, mfiId } = currentStaff(res);
  res.status(200).json(await openSharedRecord({ staffId, mfiId }, id.parse(req.params.shareId)));
});
