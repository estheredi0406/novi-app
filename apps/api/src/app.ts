import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { contributionsRouter } from "./routes/contributions.js";
import { groupsRouter } from "./routes/groups.js";
import { healthRouter } from "./routes/health.js";
import { invitationsRouter } from "./routes/invitations.js";
import { meRouter } from "./routes/me.js";
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

// Must come last: turns every error into the standard error response.
app.use(errorHandler);