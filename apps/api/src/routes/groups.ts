import { Router } from "express";
import { z } from "zod";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import {
  cancelGroup,
  cancelInvite,
  createGroup,
  getGroup,
  inviteToGroup,
  listMyGroups,
  proposeGroup,
  removeSeat,
  reviseRules,
} from "../services/groupService.js";

export const groupsRouter = Router();

// Every group route needs a logged-in member.
groupsRouter.use(requireAuth);

// The shape of a request. Ranges such as 3 to 15 members are checked by the
// rules engine, not here, so each rule lives in one place and has one
// error code; Zod only checks that the right kinds of values were sent.
const rules = z
  .object({
    amountFcfa: z.number(),
    frequency: z.enum(["WEEKLY", "MONTHLY"]),
    dueDay: z.number(),
    size: z.number(),
    payoutOrder: z.enum(["DRAWN", "FIXED"]).default("DRAWN"),
  })
  .strict();

const newGroup = rules.extend({ name: z.string().trim().min(2).max(60) }).strict();
const groupId = z.object({ id: z.string().uuid() });
const inviteBody = z.object({ phone: z.string().regex(/^\+228\d{8}$/) }).strict();
const inviteParams = groupId.extend({ inviteId: z.string().uuid() });
const seatParams = groupId.extend({ memberId: z.string().uuid() });

groupsRouter.get("/", async (_req, res) => {
  res.json(await listMyGroups(currentMember(res).userId));
});

groupsRouter.post("/", async (req, res) => {
  res.status(201).json(await createGroup(currentMember(res).userId, newGroup.parse(req.body)));
});

groupsRouter.get("/:id", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await getGroup(id, currentMember(res).userId));
});

// State changes are explicit actions, one route each (brief, section 9),
// not a general "update the group" that could change anything.
groupsRouter.post("/:id/rules", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await reviseRules(id, currentMember(res).userId, rules.parse(req.body)));
});

groupsRouter.post("/:id/propose", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await proposeGroup(id, currentMember(res).userId));
});

groupsRouter.post("/:id/cancel", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await cancelGroup(id, currentMember(res).userId));
});

// ---------- Invitations (S2.5) ----------

groupsRouter.post("/:id/invites", async (req, res) => {
  const { id } = groupId.parse(req.params);
  const { phone } = inviteBody.parse(req.body);
  res.json(await inviteToGroup(id, currentMember(res).userId, phone));
});

groupsRouter.post("/:id/invites/:inviteId/cancel", async (req, res) => {
  const { id, inviteId } = inviteParams.parse(req.params);
  res.json(await cancelInvite(id, currentMember(res).userId, inviteId));
});

groupsRouter.post("/:id/seats/:memberId/remove", async (req, res) => {
  const { id, memberId } = seatParams.parse(req.params);
  res.json(await removeSeat(id, currentMember(res).userId, memberId));
});