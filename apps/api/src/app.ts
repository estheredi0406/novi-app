import { pilotRwanda } from "./lib/phone.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { callPageRouter } from "./routes/callPage.js";
import { consoleRouter } from "./routes/console.js";
import { contributionsRouter } from "./routes/contributions.js";
import { groupsRouter } from "./routes/groups.js";
import { healthRouter } from "./routes/health.js";
import { invitationsRouter } from "./routes/invitations.js";
import { meRouter } from "./routes/me.js";
import { mfisRouter } from "./routes/mfis.js";
import { staffRouter } from "./routes/staff.js";
import { ussdRouter } from "./routes/ussd.js";
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
// D73: the USSD gateway posts forms, not JSON; this router reads them itself.
app.use("/v1/ussd", ussdRouter);

// A voice note arrives as base64 (up to about 800 KB): only that route
// accepts a body this large.
app.use("/v1/groups/:id/voice", express.json({ limit: "1mb" }));
// Turns JSON request bodies into objects that routes can read.
app.use(express.json());

app.use("/health", healthRouter);
// What the app needs to know before sign-up: which countries' numbers this
// server accepts (D111: Rwanda only on the pilot server) and whether the
// pilot's SMS inbox is on.
app.get("/v1/config", (_req, res) => {
  res.json({ pilotRwanda: pilotRwanda(), pilotSmsInbox: process.env.PILOT_SHOW_SMS === "true" });
});
app.use("/v1/auth", authRouter);
app.use("/v1/me", meRouter);
app.use("/v1/groups", groupsRouter);
app.use("/v1/invitations", invitationsRouter);
app.use("/v1/mfis", mfisRouter);
app.use("/v1/contributions", contributionsRouter);
// The MFI console: staff only, with their own tokens (D52).
app.use("/v1/staff", staffRouter);
app.use("/v1/console", consoleRouter);
app.use("/v1/verify", verifyApiRouter);
// The page a lender opens by scanning a shared record's QR code (D50).
app.use("/verify", verifyPageRouter);
// D112: the group call page, opened inside Novi with a signed pass.
app.use("/call", callPageRouter);

// The MFI console's built web app (apps/console/dist), served from the same
// address as the API so it needs no cross-origin settings (D55, D58). Only
// present once the console has been built, as it is online.
const consoleDist = fileURLToPath(new URL("../../console/dist", import.meta.url));
if (existsSync(consoleDist)) app.use("/console", express.static(consoleDist));

// D119: the member app's web version (apps/mobile/dist), for members without
// an Android phone (an iPhone, a laptop). Same address as the API, so no
// cross-origin settings either. Every other path under /app is one of the
// app's own screens: the browser gets the app, which opens that screen.
const appDist = fileURLToPath(new URL("../../mobile/dist", import.meta.url));
if (existsSync(appDist)) {
  app.use("/app", express.static(appDist));
  app.get("/app/{*screen}", (_req, res) => res.sendFile(`${appDist}/index.html`));
}

// D133: the site's root has no page of its own. A payment page (FedaPay's
// checkout, opened from the web version) sends the member back here once she
// has paid, so the root sends her on to the app, which checks the payment
// and shows the receipt. Without the app built, to the console.
app.get("/", (_req, res) => res.redirect(302, existsSync(appDist) ? "/app/" : "/console/"));

// Must come last: turns every error into the standard error response.
app.use(errorHandler);