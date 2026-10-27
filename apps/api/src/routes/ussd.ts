import { timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { pilotMode } from "../lib/pilot.js";
import { handleUssd } from "../services/ussdService.js";

// Novi by USSD (D73), reached through Africa's Talking's USSD gateway. At
// each key press the gateway posts a form (sessionId, serviceCode,
// phoneNumber, text) and shows the member the plain-text answer, which
// starts with "CON" (show and wait) or "END" (show and hang up).
//
// The gateway does not sign its requests, so the address itself carries a
// secret, USSD_CALLBACK_TOKEN, known only to Novi and the Africa's Talking
// dashboard. Without it, or with a wrong one, the route does not exist.
// While the channel is the sandbox (pilot mode), only the 20 test accounts
// may use it.
export const ussdRouter = Router();
ussdRouter.use(express.urlencoded({ extended: false, limit: "4kb" }));

const TEST_NUMBER = /^\+2289000000[1-9]$|^\+228900000(1\d|20)$/;

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
  if (pilotMode() && !TEST_NUMBER.test(phone)) {
    res.send("END Pilote Novi : seuls les comptes de test (+22890000001 à +22890000020) peuvent utiliser ce code.");
    return;
  }
  try {
    const reply = await handleUssd({ phone, text: parsed.data.text });
    res.send(`${reply.end ? "END" : "CON"} ${reply.text}`);
  } catch (err) {
    // The phone can only show text: never an error page.
    console.error("USSD session failed:", err);
    res.send("END Novi est momentanément indisponible. Réessayez plus tard.");
  }
});
