import { app } from "./app.js";
import { startPayoutJob } from "./services/payoutService.js";
import { startReminderJob } from "./services/reminderService.js";

// Hosting platforms such as Railway assign the port through the PORT
// environment variable; 3000 is the local default.
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Novi API listening on port ${port}`);
});

// Sends the pots that are due (Sprint 4). Only the running server does this;
// tests call runPayouts themselves, with the date they need.
startPayoutJob();
// Reminds members the day before and on the morning of a due date (F16).
startReminderJob();
