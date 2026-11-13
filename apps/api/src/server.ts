import { app } from "./app.js";
import { attachCallSignal } from "./services/callSignal.js";
import { startAlertJob } from "./services/alertService.js";
import { startPaymentCheckJob } from "./services/exceptionService.js";
import { startPayoutJob } from "./services/payoutService.js";
import { startReminderJob } from "./services/reminderService.js";

// Hosting platforms such as Render assign the port through the PORT
// environment variable; 3000 is the local default.
const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`Novi API listening on port ${port}`);
});
// D112: the group calls' signalling (WebSocket at /v1/call-signal).
attachCallSignal(server);

// Sends the pots that are due. Only the running server does this;
// tests call runPayouts themselves, with the date they need.
startPayoutJob();
// Reminds members the day before and on the morning of a due date (F16).
startReminderJob();
// D90: escalates what waits too long, and sends the 08:00 summary to staff.
startAlertJob();
// D114: asks the operator again about payments it has not confirmed.
startPaymentCheckJob();
