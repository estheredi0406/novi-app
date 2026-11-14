import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { pilotMode } from "../lib/pilot.js";
import { identity } from "../providers/index.js";
import { MockAnidProvider } from "../providers/identity/MockAnidProvider.js";
import { handleUssd } from "../services/ussdService.js";

// USSD through Africa's Talking (D73). The gateway posts a form at each key
// press and shows our "CON"/"END" answer. It does not sign requests, so the URL
// carries a secret (USSD_CALLBACK_TOKEN). The sandbox only accepts test accounts.
export const ussdRouter = Router();
ussdRouter.use(express.urlencoded({ extended: false, limit: "4kb" }));

const form = z.object({
  sessionId: z.string().min(1).max(100),
  serviceCode: z.string().max(40).optional(),
  phoneNumber: z.string().max(20),
  networkCode: z.string().max(20).optional(),
  text: z.string().max(200).default(""),
});

function tokenMatches(given: string): boolean {
  const expected = process.env.USSD_CALLBACK_TOKEN;
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

ussdRouter.post("/africastalking/:token", async (req, res) => {
  if (!tokenMatches(req.params.token ?? "")) {
    res.status(404).end();
    return;
  }
  const parsed = form.safeParse(req.body);
  res.type("text/plain");
  if (!parsed.success) {
    res.send("END Requête invalide.");
    return;
  }
  // The gateway sends the number as dialled from; Novi stores +228 numbers.
  const phone = parsed.data.phoneNumber.replace(/\s/g, "");
  if (pilotMode() && !(identity instanceof MockAnidProvider)) {
    res.send("END Pilote Novi : ce code de test est fermé aux comptes réels.");
    return;
  }
  try {
    const reply = await handleUssd({ phone, text: parsed.data.text, sessionId: parsed.data.sessionId });
    res.send(`${reply.end ? "END" : "CON"} ${reply.text}`);
  } catch (err) {
    // The phone can only show text: never an error page.
    console.error("USSD session failed:", err);
    res.send("END Novi est momentanément indisponible. Réessayez plus tard.");
  }
});
