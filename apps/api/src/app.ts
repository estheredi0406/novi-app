import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { consoleRouter } from "./routes/console.js";
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

// Online, requests reach the API through the host's proxy (Render). Trusting
// that one proxy makes req.ip the member's real address, which the
// per-address rate limits rely on; otherwise every request would seem to
// come from the proxy and share one limit.
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

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
app.use("/v1/console", consoleRouter);
app.use("/v1/verify", verifyApiRouter);
// The page a lender opens by scanning a shared record's QR code (D50).
app.use("/verify", verifyPageRouter);

// The MFI console's built web app (apps/console/dist), served from the same
// address as the API so it needs no cross-origin settings (D55, D58). Only
// present once the console has been built, as it is online.
const consoleDist = fileURLToPath(new URL("../../console/dist", import.meta.url));
if (existsSync(consoleDist)) app.use("/console", express.static(consoleDist));

// Must come last: turns every error into the standard error response.
app.use(errorHandler);