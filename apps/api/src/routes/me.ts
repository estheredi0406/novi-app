import { Router } from "express";
import { z } from "zod";
import { currentMember, requireAuth } from "../middleware/requireAuth.js";
import { getProfile, updateProfile } from "../services/memberService.js";
import { savePushToken } from "../services/notifyService.js";
import { answerReceipt } from "../services/payoutService.js";
import { buildRecord, listLenders, listShares, revokeShare, shareRecord } from "../services/recordService.js";

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
        phone: z.string().regex(/^\+228\d{8}$/),
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

// D79: where this phone receives notifications (Expo's token), or null to
// stop. Tied to the phone she is logged in on now.
const pushBody = z
  .object({ token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/).nullable() })
  .strict();

meRouter.put("/push-token", async (req, res) => {
  const { token } = pushBody.parse(req.body);
  await savePushToken(currentMember(res).sessionId, token);
  res.status(204).end();
});

// ---------- Her savings record, the ACEV (Sprint 6) ----------

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
const shareBody = z.object({ mfiCode: z.string().min(1).max(20).optional() }).strict();

meRouter.post("/record/shares", async (req, res) => {
  const { mfiCode } = shareBody.parse(req.body ?? {});
  res.status(201).json(await shareRecord(currentMember(res).userId, mfiCode));
});

meRouter.post("/record/shares/:shareId/revoke", async (req, res) => {
  const { shareId } = z.object({ shareId: z.string().uuid() }).parse(req.params);
  res.json(await revokeShare(currentMember(res).userId, shareId));
});

// ---------- A pot she received (D63) ----------

// "I received it" or "I did not receive it", once the MFI has paid her pot.
// A "not received" answer goes to the officer's console.
meRouter.post("/payouts/:payoutId/receipt", async (req, res) => {
  const { received } = z.object({ received: z.boolean() }).strict().parse(req.body);
  const payoutId = z.string().uuid().parse(req.params.payoutId);
  await answerReceipt(currentMember(res).userId, payoutId, received);
  res.status(204).end();
});
