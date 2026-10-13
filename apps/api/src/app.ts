import express from "express";
import { healthRouter } from "./routes/health.js";

// Creates the Express application.
export const app = express();

// Turns JSON request bodies into objects that routes can read.
app.use(express.json());

app.use("/health", healthRouter);