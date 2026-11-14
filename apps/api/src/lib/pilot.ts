// Pilot mode (D61): since real SMS to Togo cost about 0.49 USD, the pilot shows
// the code on screen with a "pilot" label. Off unless PILOT_SHOW_CODES=true.
// A code that really reached the phone by SMS is never shown.
export function pilotCode(code: string | undefined, delivered: boolean | void = false): { pilotCode?: string } {
  return process.env.PILOT_SHOW_CODES === "true" && code && delivered !== true ? { pilotCode: code } : {};
}

// D73: while the USSD channel is Africa's Talking's sandbox, only the test
// accounts may use it: a real member's PIN is typed only on her own phone.
export function pilotMode(): boolean {
  return process.env.PILOT_SHOW_CODES === "true";
}
