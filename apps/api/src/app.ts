import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { contributionsRouter } from "./routes/contributions.js";
import { groupsRouter } from "./routes/groups.js";
import { healthRouter } from "./routes/health.js";
import { invitationsRouter } from "./routes/invitations.js";
import { meRouter } from "./routes/me.js";
import { staffRouter } from "./routes/staff.js";
import { verifyApiRouter, verifyPageRouter } from "./routes/verify.js";
import { webhooksRouter } from "./routes/webhooks.js";

// Builds the Express application without starting it,
// so tests can send requests to it without opening a network port.
export const app = express();

// Payment webhooks read their raw body to check its signature, so they are
// mounted before the JSON parser.
app.use("/v1/webhooks", webhooksRouter);

// Turns JSON request bodies into objects that routes can read.
app.use(express.json());

app.use("/health", healthRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/me", meRouter);
app.use("/v1/groups", groupsRouter);
app.use("/v1/invitations", invitationsRouter);
app.use("/v1/contributions", contributionsRouter);
// The MFI console (Sprint 5): staff only, with their own tokens (D52).
app.use("/v1/staff", staffRouter);
app.use("/v1/verify", verifyApiRouter);
// The page a lender opens by scanning a shared record's QR code (D50).
app.use("/verify", verifyPageRouter);

// Must come last: turns every error into the standard error response.
app.use(errorHandler);