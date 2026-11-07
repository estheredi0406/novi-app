import { useState } from "react";
import { useServerConfig } from "../api/config";

// Novi is for Togo: +228 and 8 digits. On the pilot server (run from Kigali),
// Rwandan numbers are accepted too, +250 and 9 digits (D111): the prefix then
// becomes a switch between the two. Elsewhere it stays a plain +228.
export type Country = "TG" | "RW";
export const COUNTRIES: Record<Country, { prefix: string; length: number }> = {
  TG: { prefix: "+228", length: 8 },
  RW: { prefix: "+250", length: 9 },
};

export function countryOf(phone: string | null | undefined): Country {
  return phone?.startsWith("+250") ? "RW" : "TG";
}

export function usePhoneCountry(initial?: string | null) {
  const { pilotRwanda } = useServerConfig();
  const [chosen, setChosen] = useState<Country>(countryOf(initial));
  const country: Country = pilotRwanda ? chosen : "TG";
  const { prefix, length } = COUNTRIES[country];
  return {
    prefix,
    length,
    // Only offered on the pilot server.
    toggle: pilotRwanda ? () => setChosen((c) => (c === "TG" ? "RW" : "TG")) : undefined,
    clean: (text: string) => text.replace(/\D/g, "").slice(0, length),
    valid: (digits: string) => new RegExp(`^\\d{${length}}$`).test(digits),
    full: (digits: string) => `${prefix}${digits}`,
  };
}
