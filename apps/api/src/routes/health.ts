import { Router } from "express";

// Routes for checking that the API is up.

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});