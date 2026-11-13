import { phoneSchema } from "../lib/phone.js";
import {
  connectPaymentAccount,
  disconnectPaymentAccount,
  paymentAccountStatus,
  setPayoutsViaFedapay,
} from "../services/paymentAccounts.js";
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
  getAccounts,
  getToday,
  getGroupAccount,
  listReported,
  resolveReported,
  setAutoRelease,
  retryPayout,
} from "../services/consoleService.js";
import {
  decideLoan,
  getCreditPolicy,
  getLoan,
  listLoans,
  previewPolicy,
  saveCreditPolicy,
} from "../services/loanService.js";
import { AppError } from "../lib/errors.js";
import { consoleSavings, decideAccount, saveSavingsPolicy } from "../services/savingsService.js";
import { retryReturns } from "../services/reserveService.js";
import { getMoney, resolveMismatch } from "../services/moneyCheckService.js";
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
import { closeCompliance, groupRound, openCompliance } from "../services/consoleGroupService.js";

// The MFI console's data. Staff only; every answer is limited
// to the officer's own MFI (D52).
export const consoleRouter = Router();
consoleRouter.use(requireStaff);

// D117: a compliance officer reads everything but moves no money and decides
// nothing: every change is refused, except opening and closing the
// compliance view and previewing credit rules, which change nothing.
consoleRouter.use((req, res, next) => {
  if (
    res.locals.staff?.role === "COMPLIANCE" &&
    req.method !== "GET" &&
    !/\/compliance(\/close)?$|\/credit-policy\/preview$/.test(req.path)
  ) {
    throw new AppError("READ_ONLY_ROLE", 403);
  }
  next();
});

const id = z.string().uuid();

consoleRouter.get("/overview", async (_req, res) => {
  res.status(200).json(await getOverview(currentStaff(res).mfiId));
});

consoleRouter.get("/groups", async (_req, res) => {
  res.status(200).json(await listConsoleGroups(currentStaff(res).mfiId));
});

// D117: one round's payments on the group page, without names (D33).
consoleRouter.get("/groups/:groupId/rounds/:number", async (req, res) => {
  const number = z.coerce.number().int().min(1).parse(req.params.number);
  res.status(200).json(await groupRound(currentStaff(res).mfiId, id.parse(req.params.groupId), number));
});

// D117: the compliance view: names, with a reason, logged, for 15 minutes.
consoleRouter.post("/groups/:groupId/compliance", async (req, res) => {
  const staff = currentStaff(res);
  const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).strict().parse(req.body);
  res.status(200).json(await openCompliance(staff.mfiId, staff, id.parse(req.params.groupId), reason));
});

consoleRouter.post("/groups/:groupId/compliance/close", async (req, res) => {
  await closeCompliance(currentStaff(res).staffId, id.parse(req.params.groupId));
  res.status(204).end();
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

// D113: Novi's ledger, the MFI's books and the FedaPay balance, side by side.
// D116: today's figures for "Aujourd'hui".
consoleRouter.get("/today", async (_req, res) => {
  res.status(200).json(await getToday(currentStaff(res).mfiId));
});

consoleRouter.get("/accounts", async (_req, res) => {
  res.status(200).json(await getAccounts(currentStaff(res).mfiId));
});

consoleRouter.get("/groups/:groupId/account", async (req, res) => {
  res.status(200).json(await getGroupAccount(currentStaff(res).mfiId, id.parse(req.params.groupId)));
});

consoleRouter.get("/attention", async (_req, res) => {
  const staff = currentStaff(res);
  res.status(200).json(await listAttention(staff.mfiId, staff.staffId));
});

// D105: payments a member says left her account, for the officer to check
// against the operator's statement; and his answer.
consoleRouter.get("/reported", async (_req, res) => {
  res.status(200).json(await listReported(currentStaff(res).mfiId));
});

consoleRouter.post("/reported/:contributionId", async (req, res) => {
  const staff = currentStaff(res);
  const { arrived } = z.object({ arrived: z.boolean() }).strict().parse(req.body);
  res
    .status(200)
    .json(await resolveReported(staff.mfiId, staff.staffId, id.parse(req.params.contributionId), arrived));
});

// D102: the MFI's own FedaPay account. Every officer sees whether it is
// connected; only an administrator connects, disconnects or changes it.
consoleRouter.get("/payment-account", async (_req, res) => {
  res.status(200).json(await paymentAccountStatus(currentStaff(res).mfiId));
});

consoleRouter.put("/payment-account", async (req, res) => {
  const staff = currentStaff(res);
  if (staff.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
  const input = z
    .object({
      secretKey: z.string().trim().min(10).max(200),
      webhookSecret: z.string().trim().min(10).max(200),
      live: z.boolean(),
    })
    .strict()
    .parse(req.body);
  res.status(200).json(await connectPaymentAccount(staff.mfiId, staff.staffId, input));
});

consoleRouter.post("/payment-account/disconnect", async (_req, res) => {
  const staff = currentStaff(res);
  if (staff.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
  res.status(200).json(await disconnectPaymentAccount(staff.mfiId, staff.staffId));
});

consoleRouter.put("/payment-account/payouts", async (req, res) => {
  const staff = currentStaff(res);
  if (staff.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
  const { fedapay } = z.object({ fedapay: z.boolean() }).strict().parse(req.body);
  res.status(200).json(await setPayoutsViaFedapay(staff.mfiId, staff.staffId, fedapay));
});

// D105: the amount up to which a full pot leaves without an officer. Admin only.
consoleRouter.put("/auto-release", async (req, res) => {
  const staff = currentStaff(res);
  if (staff.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
  // null turns automatic release off: an officer releases every pot (D63).
  const { amountFcfa } = z
    .object({ amountFcfa: z.number().int().min(0).max(10_000_000).nullable() })
    .strict()
    .parse(req.body);
  res.status(200).json({ autoReleaseFcfa: await setAutoRelease(staff.mfiId, staff.staffId, amountFcfa) });
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
const phone = phoneSchema;

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

// D149: send again the advances refused at the end of a cycle.
consoleRouter.post("/groups/:groupId/returns/retry", async (req, res) => {
  const staff = currentStaff(res);
  const groupId = z.string().uuid().parse(req.params.groupId);
  res.json({ retried: await retryReturns(staff.mfiId, staff.staffId, groupId) });
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
    role: z.enum(["OFFICER", "ADMIN", "COMPLIANCE"]),
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

// ---------- D89: microloan requests ----------

consoleRouter.get("/loans", async (_req, res) => {
  res.status(200).json(await listLoans(currentStaff(res).mfiId));
});

consoleRouter.get("/loans/:loanId", async (req, res) => {
  res
    .status(200)
    .json(await getLoan(currentStaff(res).mfiId, id.parse(req.params.loanId)));
});

// First look: preselect (she comes to sign) or decline. At the agency:
// granted, with the amount, or not granted.
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

// ---------- D123: members' savings ----------

consoleRouter.get("/savings", async (_req, res) => {
  res.json(await consoleSavings(currentStaff(res).mfiId));
});

consoleRouter.post("/savings/:accountId/decide", async (req, res) => {
  const staff = currentStaff(res);
  const accountId = z.string().uuid().parse(req.params.accountId);
  const body = z
    .union([
      z.object({ open: z.literal(true) }).strict(),
      z.object({ open: z.literal(false), reason: z.string().trim().min(3).max(300) }).strict(),
    ])
    .parse(req.body);
  res.json(await decideAccount(staff.mfiId, staff.staffId, accountId, body));
});

consoleRouter.put("/savings/policy", async (req, res) => {
  const staff = currentStaff(res);
  if (staff.role !== "ADMIN") throw new AppError("ADMIN_ONLY", 403);
  const bp = z.number().int().min(0).max(2400).nullable(); // at most 24 %
  const body = z
    .object({
      freeBp: bp,
      lock3Bp: bp,
      lock6Bp: bp,
      lock12Bp: bp,
      requireForLoan: z.boolean(),
      // D147: the caisse's conditions; a fee of 0 is a real answer.
      openingFeeFcfa: z.number().int().min(0).max(1_000_000).nullable(),
      monthlyFeeFcfa: z.number().int().min(0).max(1_000_000).nullable(),
      withdrawalFeeFcfa: z.number().int().min(0).max(1_000_000).nullable(),
      minKeepFcfa: z.number().int().min(0).max(1_000_000).nullable(),
      earlyRule: z.enum(["LOSE_GAINS", "PENALTY"]).nullable(),
      earlyPenaltyBp: bp,
    })
    .strict()
    .parse(req.body);
  res.json(await saveSavingsPolicy(staff.mfiId, staff.staffId, body));
});

// ---------- D124: where the money is, and what does not match ----------

consoleRouter.get("/money", async (_req, res) => {
  res.json(await getMoney(currentStaff(res).mfiId));
});

consoleRouter.post("/money/mismatches/:contributionId/resolve", async (req, res) => {
  const staff = currentStaff(res);
  const contributionId = z.string().uuid().parse(req.params.contributionId);
  const { note } = z.object({ note: z.string().trim().min(3).max(300) }).strict().parse(req.body);
  res.json(await resolveMismatch(staff.mfiId, staff.staffId, contributionId, note));
});
