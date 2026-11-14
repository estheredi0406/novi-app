import { z } from "zod";

// Novi is for Togo (+228, 8 digits). PILOT_RWANDA=true also accepts Rwandan
// numbers on the pilot server (D111), for testers in Kigali. Off by default.
const TOGO = /^\+228\d{8}$/;
const RWANDA = /^\+250\d{9}$/;

export function pilotRwanda(): boolean {
  return process.env.PILOT_RWANDA === "true";
}

export function acceptedPhone(phone: string): boolean {
  return TOGO.test(phone) || (pilotRwanda() && RWANDA.test(phone));
}

export const phoneSchema = z.string().refine(acceptedPhone, "Expected +228 and 8 digits");
