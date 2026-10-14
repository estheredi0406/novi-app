import { Router } from "express";
import type { HealthResponse } from "@novi/shared";
import { prisma } from "../lib/db.js";

// Reports whether the API can do its job: the server is running
// and the database answers.
export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    // The cheapest possible query: reads no table, only proves
    // the database accepts a connection and answers.
    await prisma.$queryRaw`SELECT 1`;
    const body: HealthResponse = { status: "ok", database: "ok" };
    res.status(200).json(body);
  } catch (error) {
    // Full details go to the server log only; the response reveals
    // nothing about the database's address or credentials.
    console.error("Health check: database unreachable", error);
    const body: HealthResponse = { status: "degraded", database: "unreachable" };
    res.status(503).json(body);
  }
});