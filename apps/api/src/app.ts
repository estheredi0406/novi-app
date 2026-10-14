import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";

// Builds the Express application without starting it,
// so tests can send requests to it without opening a network port.
export const app = express();

// Turns JSON request bodies into objects that routes can read.
app.use(express.json());

app.use("/health", healthRouter);
app.use("/v1/auth", authRouter);

// Must come last: turns every error into the standard error response.
app.use(errorHandler);