import { z } from "zod";

// Novi is for Togo: a member's number is +228 and 8 digits. The pilot is run
// from Kigali, so PILOT_RWANDA=true on the pilot server also accepts Rwandan
// numbers, +250 and 9 digits, for testers who want real SMS (D111). Off by
// default, and never for the product.
const TOGO = /^\+228\d{8}$/;
const RWANDA = /^\+250\d{9}$/;

export function pilotRwanda(): boolean {
  return process.env.PILOT_RWANDA === "true";
}

export function acceptedPhone(phone: string): boolean {
  return TOGO.test(phone) || (pilotRwanda() && RWANDA.test(phone));
}

export const phoneSchema = z.string().refine(acceptedPhone, "Expected +228 and 8 digits");
