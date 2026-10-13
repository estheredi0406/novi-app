import { app } from "./app.js";

// Hosting platforms such as Railway assign the port through the PORT
// environment variable; 3000 is the local default.
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Novi API listening on port ${port}`);
});