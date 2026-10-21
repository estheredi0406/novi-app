import express, { Router } from "express";
import { handlePaymentWebhook } from "../services/moneyService.js";

// Calls from the payment provider, not from a member: no login, but every
// call must carry a valid signature (checked in the service).
export const webhooksRouter = Router();

// The signature covers the exact bytes sent, so this route reads the raw body
// instead of letting the JSON parser rebuild it.
webhooksRouter.use(express.raw({ type: "*/*", limit: "100kb" }));

webhooksRouter.post("/payments", async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  await handlePaymentWebhook(rawBody, req.header("x-fedapay-signature"));
  res.json({ received: true });
});
