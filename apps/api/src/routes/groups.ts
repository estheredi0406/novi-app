import { Router } from "express";
import { z } from "zod";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import {
  acceptRules,
  cancelGroup,
  cancelInvite,
  counterRules,
  createGroup,
  declineGroup,
  getGroup,
  inviteToGroup,
  listMyGroups,
  proposeGroup,
  removeSeat,
  reviseRules,
  setPayoutOrder,
  startGroup,
} from "../services/groupService.js";
import { hideMessage, listMessages, MAX_LENGTH, postMessage } from "../services/chatService.js";
import { cancelMeeting, joinMeeting, listMeetings, scheduleMeeting } from "../services/meetingService.js";
import { getRound, listLedger, listRounds, payRound } from "../services/moneyService.js";

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
// The version she read is sent with her answer, so a change made while she
// was reading is caught (D29).
const acceptBody = z.object({ version: z.number() }).strict();
const counterBody = z.object({ version: z.number(), note: z.string().trim().min(1).max(280) }).strict();
const emptyBody = z.object({}).strict();
const orderBody = z.object({ memberIds: z.array(z.string().uuid()) }).strict();
const roundParams = groupId.extend({ number: z.coerce.number().int() });
const payBody = z.object({ operator: z.enum(["MOOV_TG", "TOGOCEL"]) }).strict();

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

// ---------- Answering (S2.6) ----------

groupsRouter.post("/:id/accept", async (req, res) => {
  const { id } = groupId.parse(req.params);
  const { version } = acceptBody.parse(req.body);
  res.json(await acceptRules(id, currentMember(res).userId, version));
});

groupsRouter.post("/:id/counter", async (req, res) => {
  const { id } = groupId.parse(req.params);
  const { version, note } = counterBody.parse(req.body);
  res.json(await counterRules(id, currentMember(res).userId, version, note));
});

// After declining she no longer has a seat, so there is no group to send back.
groupsRouter.post("/:id/decline", async (req, res) => {
  const { id } = groupId.parse(req.params);
  emptyBody.parse(req.body);
  await declineGroup(id, currentMember(res).userId);
  res.status(204).end();
});

// ---------- Payout order and start (S2.7) ----------

groupsRouter.post("/:id/order", async (req, res) => {
  const { id } = groupId.parse(req.params);
  const { memberIds } = orderBody.parse(req.body);
  res.json(await setPayoutOrder(id, currentMember(res).userId, memberIds));
});

groupsRouter.post("/:id/start", async (req, res) => {
  const { id } = groupId.parse(req.params);
  emptyBody.parse(req.body);
  res.json(await startGroup(id, currentMember(res).userId));
});

// ---------- Money in (Sprint 3) ----------

groupsRouter.get("/:id/rounds", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await listRounds(id, currentMember(res).userId));
});

groupsRouter.get("/:id/rounds/:number", async (req, res) => {
  const { id, number } = roundParams.parse(req.params);
  res.json(await getRound(id, currentMember(res).userId, number));
});

// Answers 202: the request is sent to her phone, and the payment is not done
// until she confirms there and the provider tells Novi.
groupsRouter.post("/:id/rounds/:number/pay", async (req, res) => {
  const { id, number } = roundParams.parse(req.params);
  const { operator } = payBody.parse(req.body);
  res.status(202).json(await payRound(id, currentMember(res).userId, number, operator));
});

groupsRouter.get("/:id/ledger", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await listLedger(id, currentMember(res).userId));
});

// ---------- The group's chat (D70) ----------

const chatQuery = z
  .object({ after: z.string().uuid().optional(), before: z.string().uuid().optional() })
  .strict()
  .refine((q) => !(q.after && q.before));
const chatBody = z.object({ body: z.string().trim().min(1).max(MAX_LENGTH) }).strict();
const messageParams = groupId.extend({ messageId: z.string().uuid() });

groupsRouter.get("/:id/messages", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await listMessages(id, currentMember(res).userId, chatQuery.parse(req.query)));
});

groupsRouter.post("/:id/messages", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.status(201).json(await postMessage(id, currentMember(res).userId, chatBody.parse(req.body).body));
});

groupsRouter.post("/:id/messages/:messageId/hide", async (req, res) => {
  const { id, messageId } = messageParams.parse(req.params);
  res.json(await hideMessage(id, currentMember(res).userId, messageId));
});

// ---------- Group meetings (D71) ----------

const meetingBody = z
  .object({
    title: z.string().trim().min(3).max(80),
    agenda: z.string().trim().max(300).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    durationMin: z.number().int(),
  })
  .strict();
const meetingParams = groupId.extend({ meetingId: z.string().uuid() });

groupsRouter.get("/:id/meetings", async (req, res) => {
  const { id } = groupId.parse(req.params);
  res.json(await listMeetings(id, currentMember(res).userId));
});

groupsRouter.post("/:id/meetings", async (req, res) => {
  const { id } = groupId.parse(req.params);
  const body = meetingBody.parse(req.body);
  res
    .status(201)
    .json(await scheduleMeeting(id, currentMember(res).userId, { ...body, startsAt: new Date(body.startsAt) }));
});

groupsRouter.post("/:id/meetings/:meetingId/cancel", async (req, res) => {
  const { id, meetingId } = meetingParams.parse(req.params);
  res.json(await cancelMeeting(id, currentMember(res).userId, meetingId));
});

groupsRouter.post("/:id/meetings/:meetingId/join", async (req, res) => {
  const { id, meetingId } = meetingParams.parse(req.params);
  res.json(await joinMeeting(id, currentMember(res).userId, meetingId));
});
