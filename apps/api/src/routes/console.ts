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
import { changeOrganiser, changePhone, lookupMember, recordExit } from "../services/protectionService.js";
import { listSharedWithMfi, openSharedRecord } from "../services/recordService.js";
import { addOfficer, deactivateOfficer, listTeam, reactivateOfficer, resetAccess } from "../services/staffService.js";
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

// D69: protecting the group. A member found by her phone number at the
// counter; her death or departure; a new number; a new organiser.
const phone = z.string().regex(/^\+228\d{8}$/);

consoleRouter.get("/members", async (req, res) => {
  const staff = currentStaff(res);
  const query = z.object({ phone }).parse(req.query);
  res.status(200).json(await lookupMember(staff.mfiId, staff.staffId, query.phone));
});

consoleRouter.post("/members/:userId/exit", async (req, res) => {
  const staff = currentStaff(res);
  const body = z
    .object({ groupId: id, reason: z.enum(["DEATH", "LEFT"]), payoutPhone: phone.optional() })
    .strict()
    .parse(req.body);
  res.status(200).json(await recordExit(staff.mfiId, staff.staffId, id.parse(req.params.userId), body));
});

consoleRouter.post("/members/:userId/phone", async (req, res) => {
  const staff = currentStaff(res);
  const body = z.object({ phone }).strict().parse(req.body);
  res.status(200).json(await changePhone(staff.mfiId, staff.staffId, id.parse(req.params.userId), body.phone));
});

consoleRouter.post("/groups/:groupId/organiser", async (req, res) => {
  const staff = currentStaff(res);
  const body = z.object({ userId: id }).strict().parse(req.body);
  res
    .status(200)
    .json(await changeOrganiser(staff.mfiId, staff.staffId, id.parse(req.params.groupId), body.userId));
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

// ---------- The team, for the MFI's administrators (D81) ----------

const newOfficer = z
  .object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(200), role: z.enum(["OFFICER", "ADMIN"]) })
  .strict();

consoleRouter.get("/team", async (_req, res) => {
  res.status(200).json(await listTeam(currentStaff(res)));
});

consoleRouter.post("/team", async (req, res) => {
  res.status(201).json(await addOfficer(currentStaff(res), newOfficer.parse(req.body)));
});

consoleRouter.post("/team/:staffId/deactivate", async (req, res) => {
  res.status(200).json(await deactivateOfficer(currentStaff(res), id.parse(req.params.staffId)));
});

consoleRouter.post("/team/:staffId/reactivate", async (req, res) => {
  res.status(200).json(await reactivateOfficer(currentStaff(res), id.parse(req.params.staffId)));
});

consoleRouter.post("/team/:staffId/reset", async (req, res) => {
  res.status(200).json(await resetAccess(currentStaff(res), id.parse(req.params.staffId)));
});
