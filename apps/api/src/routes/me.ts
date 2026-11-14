import { prisma } from "../lib/db.js";
import { phoneSchema } from "../lib/phone.js";
import { Router } from "express";
import { z } from "zod";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import { getProfile, updateProfile } from "../services/memberService.js";
import { BUSINESS_KINDS, BUSINESS_SINCE, getLoanPage, requestLoan, withdrawLoan } from "../services/loanService.js";
import { getStatement, listNews, readNotice } from "../services/newsService.js";
import { breakPlacement, choosePot, mySavings, withdraw } from "../services/savingsService.js";
import { savePushToken } from "../services/notifyService.js";
import { answerReceipt, potAnswered } from "../services/payoutService.js";
import {
  buildRecord,
  listLenders,
  listShares,
  revokeShare,
  shareRecord,
} from "../services/recordService.js";

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
    // D69: the person who receives what she is owed if she dies; null removes it.
    nextOfKin: z
      .object({
        name: z.string().trim().min(2).max(80),
        phone: phoneSchema,
        relation: z.string().trim().min(2).max(40),
      })
      .strict()
      .nullable()
      .optional(),
    // D79: chat notifications on or off.
    notifyChat: z.boolean().optional(),
  })
  .strict();

meRouter.get("/", async (_req, res) => {
  res.json(await getProfile(currentMember(res).userId));
});

meRouter.patch("/", async (req, res) => {
  const changes = profileChanges.parse(req.body);
  res.json(await updateProfile(currentMember(res).userId, changes));
});

// D92: what moved in her groups lately, for home and the bell.
meRouter.get("/news", async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(50).catch(30).parse(req.query.limit);
  res.json(await listNews(currentMember(res).userId, limit));
});

// D157: she opened a notification kept in the app.
meRouter.post("/notices/:noticeId/read", async (req, res) => {
  await readNotice(currentMember(res).userId, z.string().uuid().parse(req.params.noticeId));
  res.status(204).end();
});

// D92: her payments and pots, line by line, for "Mon relevé".
meRouter.get("/statement", async (_req, res) => {
  res.json(await getStatement(currentMember(res).userId));
});

// D111: on the pilot, the SMS her phone would have received (simulated ones
// included), so testers see them without real SMS being paid for.
meRouter.get("/sms", async (_req, res) => {
  if (process.env.PILOT_SHOW_SMS !== "true") {
    res.json({ enabled: false, messages: [] });
    return;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentMember(res).userId }, select: { phone: true } });
  const rows = await prisma.smsLog.findMany({
    where: { phone: user.phone },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({
    enabled: true,
    messages: rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), text: r.text ?? "", real: r.real })),
  });
});

// D79: where this phone receives notifications (Expo's token), or null to
// stop. Tied to the phone she is logged in on now.
const pushBody = z
  .object({
    token: z
      .string()
      .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/)
      .nullable(),
  })
  .strict();

meRouter.put("/push-token", async (req, res) => {
  const { token } = pushBody.parse(req.body);
  await savePushToken(currentMember(res).sessionId, token);
  res.status(204).end();
});

// ---------- Her savings record, the ACEV ----------

// Only she sees her own record (D33).
meRouter.get("/record", async (_req, res) => {
  res.json(await buildRecord(currentMember(res).userId));
});

meRouter.get("/record/shares", async (_req, res) => {
  res.json(await listShares(currentMember(res).userId));
});

// The MFIs she can share with by name (D54).
meRouter.get("/record/lenders", async (_req, res) => {
  res.json(await listLenders());
});

// She shares it: a signed snapshot, valid 30 days (D50), with one MFI by its
// code (D54), or as a code for any lender when mfiCode is left out.
const shareBody = z
  .object({ mfiCode: z.string().min(1).max(20).optional() })
  .strict();

meRouter.post("/record/shares", async (req, res) => {
  const { mfiCode } = shareBody.parse(req.body ?? {});
  res.status(201).json(await shareRecord(currentMember(res).userId, mfiCode));
});

meRouter.post("/record/shares/:shareId/revoke", async (req, res) => {
  const { shareId } = z
    .object({ shareId: z.string().uuid() })
    .parse(req.params);
  res.json(await revokeShare(currentMember(res).userId, shareId));
});

// ---------- A pot she received (D63) ----------

// "I received it" or "I did not receive it", once the MFI has paid her pot.
// A "not received" answer goes to the officer's console.
meRouter.post("/payouts/:payoutId/receipt", async (req, res) => {
  const { received } = z
    .object({ received: z.boolean() })
    .strict()
    .parse(req.body);
  const payoutId = z.string().uuid().parse(req.params.payoutId);
  await answerReceipt(currentMember(res).userId, payoutId, received);
  res.status(204).end();
});

// ---------- D123: her savings at the MFI ----------

meRouter.get("/savings", async (_req, res) => {
  res.json(await mySavings(currentMember(res).userId));
});

const potChoiceBody = z
  .object({
    keepFcfa: z.number().int().min(0).max(10_000_000),
    pocket: z.enum(["FREE", "LOCKED"]),
    lockMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).nullable(),
    consent: z.boolean(),
  })
  .strict();

meRouter.put("/savings/choices/:roundId", async (req, res) => {
  const roundId = z.string().uuid().parse(req.params.roundId);
  const body = potChoiceBody.parse(req.body);
  const view = await choosePot(currentMember(res).userId, { roundId, ...body });
  const round = await prisma.round.findUnique({ where: { id: roundId }, select: { groupId: true } });
  if (round) void potAnswered(round.groupId); // D151
  res.json(view);
});

// D147: her choice for her pot in a group, before it starts or while it runs.
meRouter.put("/savings/groups/:groupId", async (req, res) => {
  const groupId = z.string().uuid().parse(req.params.groupId);
  const body = potChoiceBody.parse(req.body);
  const view = await choosePot(currentMember(res).userId, { groupId, ...body });
  void potAnswered(groupId); // D151: her pot may only have been waiting for her
  res.json(view);
});

// Takes a whole placement back before its date: it earns nothing.
meRouter.post("/savings/:accountId/placements/:entryId/withdraw", async (req, res) => {
  const accountId = z.string().uuid().parse(req.params.accountId);
  const entryId = z.string().uuid().parse(req.params.entryId);
  res.json(await breakPlacement(currentMember(res).userId, { accountId, entryId }));
});

meRouter.post("/savings/:accountId/withdraw", async (req, res) => {
  const accountId = z.string().uuid().parse(req.params.accountId);
  const body = z.object({ amountFcfa: z.number().int().min(500).max(10_000_000) }).strict().parse(req.body);
  res.json(await withdraw(currentMember(res).userId, { accountId, ...body }));
});

// ---------- Microloan requests to the MFI (D89) ----------

meRouter.get("/loans", async (_req, res) => {
  res.json(await getLoanPage(currentMember(res).userId));
});

const loanRequest = z
  .object({
    amountFcfa: z.number().int().min(5000).max(5_000_000),
    purpose: z.enum(["STOCK", "EQUIPMENT", "OTHER"]),
    business: z
      .object({
        kind: z.enum(BUSINESS_KINDS as [string, ...string[]]),
        since: z.enum(BUSINESS_SINCE as [string, ...string[]]),
        weeklySalesFcfa: z.number().int().min(100).max(100_000_000),
        place: z.string().trim().min(2).max(80),
      })
      .strict(),
  })
  .strict();

meRouter.post("/loans", async (req, res) => {
  const body = loanRequest.parse(req.body) as Parameters<typeof requestLoan>[1];
  res.status(201).json(await requestLoan(currentMember(res).userId, body));
});

meRouter.post("/loans/:loanId/withdraw", async (req, res) => {
  const loanId = z.string().uuid().parse(req.params.loanId);
  res.json(await withdrawLoan(currentMember(res).userId, loanId));
});
