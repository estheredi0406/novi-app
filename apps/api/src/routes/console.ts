import { Router } from "express";
import { z } from "zod";
import { currentStaff, requireStaff } from "../middleware/requireStaff.js";
import {
  advanceDueDateForDemo,
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
  listAdvances,
  sendAdvance,
} from "../services/consoleService.js";
import {
  decideLoan,
  getCreditPolicy,
  getLoan,
  listLoans,
  openDocument,
  previewPolicy,
  reviewDocument,
  saveCreditPolicy,
} from "../services/loanService.js";
import { AppError } from "../lib/errors.js";
import {
  changeOrganiser,
  changePhone,
  lookupMember,
  recordExit,
} from "../services/protectionService.js";
import {
  listSharedWithMfi,
  openSharedRecord,
} from "../services/recordService.js";
import {
  addOfficer,
  deactivateOfficer,
  listTeam,
  reactivateOfficer,
  resetAccess,
} from "../services/staffService.js";
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
  res
    .status(200)
    .json(
      await getConsoleGroup(
        currentStaff(res).mfiId,
        id.parse(req.params.groupId),
      ),
    );
});

consoleRouter.get("/attention", async (_req, res) => {
  res.status(200).json(await listAttention(currentStaff(res).mfiId));
});

// D66: a started group waits for the officer's approval before its account opens.
consoleRouter.post("/groups/:groupId/approve", async (req, res) => {
  const staff = currentStaff(res);
  res
    .status(200)
    .json(
      await approveGroup(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.groupId),
      ),
    );
});

consoleRouter.post("/groups/:groupId/decline", async (req, res) => {
  const staff = currentStaff(res);
  const { reason } = z
    .object({ reason: z.string().trim().min(3).max(300) })
    .strict()
    .parse(req.body);
  res
    .status(200)
    .json(
      await declineGroup(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.groupId),
        reason,
      ),
    );
});

// D67: the portfolio over time, and what the officers did.
consoleRouter.get("/analytics", async (_req, res) => {
  res.status(200).json(await getAnalytics(currentStaff(res).mfiId));
});

// D82, pilot only: a round falls due today, for a test or a demonstration.
consoleRouter.post("/groups/:groupId/demo-due", async (req, res) => {
  const staff = currentStaff(res);
  res
    .status(200)
    .json(
      await advanceDueDateForDemo(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.groupId),
      ),
    );
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
  res
    .status(200)
    .json(await lookupMember(staff.mfiId, staff.staffId, query.phone));
});

consoleRouter.post("/members/:userId/exit", async (req, res) => {
  const staff = currentStaff(res);
  const body = z
    .object({
      groupId: id,
      reason: z.enum(["DEATH", "LEFT"]),
      payoutPhone: phone.optional(),
    })
    .strict()
    .parse(req.body);
  res
    .status(200)
    .json(
      await recordExit(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.userId),
        body,
      ),
    );
});

consoleRouter.post("/members/:userId/phone", async (req, res) => {
  const staff = currentStaff(res);
  const body = z.object({ phone }).strict().parse(req.body);
  res
    .status(200)
    .json(
      await changePhone(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.userId),
        body.phone,
      ),
    );
});

consoleRouter.post("/groups/:groupId/organiser", async (req, res) => {
  const staff = currentStaff(res);
  const body = z.object({ userId: id }).strict().parse(req.body);
  res
    .status(200)
    .json(
      await changeOrganiser(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.groupId),
        body.userId,
      ),
    );
});

// D63: a full, due pot leaves only when the officer releases it.
consoleRouter.post("/payouts/:payoutId/release", async (req, res) => {
  const staff = currentStaff(res);
  res
    .status(200)
    .json(
      await releaseRoundPayout(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.payoutId),
      ),
    );
});

consoleRouter.post("/payouts/:payoutId/retry", async (req, res) => {
  const staff = currentStaff(res);
  res
    .status(200)
    .json(
      await retryPayout(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.payoutId),
      ),
    );
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
  res
    .type("html")
    .send(
      await documentFor(check, shareId, `${req.protocol}://${req.get("host")}`),
    );
});

consoleRouter.get("/records/:shareId", async (req, res) => {
  const { staffId, mfiId } = currentStaff(res);
  res
    .status(200)
    .json(
      await openSharedRecord({ staffId, mfiId }, id.parse(req.params.shareId)),
    );
});

// ---------- The team, for the MFI's administrators (D81) ----------

const newOfficer = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(200),
    role: z.enum(["OFFICER", "ADMIN"]),
  })
  .strict();

consoleRouter.get("/team", async (_req, res) => {
  res.status(200).json(await listTeam(currentStaff(res)));
});

consoleRouter.post("/team", async (req, res) => {
  res
    .status(201)
    .json(await addOfficer(currentStaff(res), newOfficer.parse(req.body)));
});

consoleRouter.post("/team/:staffId/deactivate", async (req, res) => {
  res
    .status(200)
    .json(
      await deactivateOfficer(currentStaff(res), id.parse(req.params.staffId)),
    );
});

consoleRouter.post("/team/:staffId/reactivate", async (req, res) => {
  res
    .status(200)
    .json(
      await reactivateOfficer(currentStaff(res), id.parse(req.params.staffId)),
    );
});

consoleRouter.post("/team/:staffId/reset", async (req, res) => {
  res
    .status(200)
    .json(await resetAccess(currentStaff(res), id.parse(req.params.staffId)));
});

// ---------- D89: microloan requests; D88: advances from the fund ----------

consoleRouter.get("/loans", async (_req, res) => {
  res.status(200).json(await listLoans(currentStaff(res).mfiId));
});

consoleRouter.get("/loans/:loanId", async (req, res) => {
  res
    .status(200)
    .json(await getLoan(currentStaff(res).mfiId, id.parse(req.params.loanId)));
});

// D91: preselect (ask for her documents) or decline; after the meeting at
// the agency, record the outcome: granted (with the amount) or not.
const loanDecision = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preselect"),
      note: z.string().trim().max(280).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("decline"),
      reason: z.string().trim().min(3).max(280),
    })
    .strict(),
  z
    .object({
      action: z.literal("grant"),
      grantedFcfa: z.number().int().positive(),
      note: z.string().trim().max(280).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("notGranted"),
      reason: z.string().trim().min(3).max(280),
    })
    .strict(),
]);

consoleRouter.post("/loans/:loanId/decide", async (req, res) => {
  const staff = currentStaff(res);
  const decision = loanDecision.parse(req.body);
  res
    .status(200)
    .json(
      await decideLoan(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.loanId),
        decision,
      ),
    );
});

// D91: one photo of a document, for the officer; each view is logged.
consoleRouter.get("/loans/:loanId/documents/:documentId", async (req, res) => {
  const staff = currentStaff(res);
  const file = await openDocument(
    staff.mfiId,
    staff.staffId,
    id.parse(req.params.loanId),
    id.parse(req.params.documentId),
  );
  res
    .set("Content-Type", file.mime)
    .set("Cache-Control", "no-store")
    .send(file.data);
});

consoleRouter.post(
  "/loans/:loanId/documents/:documentId/review",
  async (req, res) => {
    const staff = currentStaff(res);
    const review = z
      .object({
        accepted: z.boolean(),
        note: z.string().trim().max(200).optional(),
      })
      .strict()
      .parse(req.body);
    res
      .status(200)
      .json(
        await reviewDocument(
          staff.mfiId,
          staff.staffId,
          id.parse(req.params.loanId),
          id.parse(req.params.documentId),
          review,
        ),
      );
  },
);

// D91: the MFI's own credit conditions. Every officer reads them; only an
// administrator changes them, and each change is logged.
const policyBody = z
  .object({
    enabled: z.boolean(),
    minCycles: z.number().int().min(0).max(10),
    minStreak: z.number().int().min(1).max(52),
    minOnTimePct: z.number().int().min(50).max(100),
    ceilingTimesPot: z.number().int().min(1).max(10),
    waitDays: z.number().int().min(0).max(365),
    months: z.array(z.number().int().min(1).max(36)).min(1).max(6),
    documents: z
      .array(
        z
          .object({
            key: z.string().regex(/^[A-Z0-9_]{2,30}$/),
            label: z.string().trim().min(3).max(140),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

consoleRouter.get("/credit-policy", async (_req, res) => {
  res.status(200).json(await getCreditPolicy(currentStaff(res).mfiId));
});

consoleRouter.put("/credit-policy", async (req, res) => {
  const staff = currentStaff(res);
  if (staff.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
  res
    .status(200)
    .json(
      await saveCreditPolicy(
        staff.mfiId,
        staff.staffId,
        policyBody.parse(req.body),
      ),
    );
});

consoleRouter.post("/credit-policy/preview", async (req, res) => {
  res
    .status(200)
    .json(
      await previewPolicy(currentStaff(res).mfiId, policyBody.parse(req.body)),
    );
});

consoleRouter.get("/advances", async (_req, res) => {
  res.status(200).json(await listAdvances(currentStaff(res).mfiId));
});

consoleRouter.post("/advances/:advanceId/send", async (req, res) => {
  const staff = currentStaff(res);
  res
    .status(200)
    .json(
      await sendAdvance(
        staff.mfiId,
        staff.staffId,
        id.parse(req.params.advanceId),
      ),
    );
});
