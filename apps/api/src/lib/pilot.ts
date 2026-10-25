// Pilot mode (D61). While SMS is still a mock and real SMS to Togo costs
// about 0.49 USD each, the online pilot returns each one-time code in the API
// response, and the app shows it on screen with a "pilot" label. Off unless
// PILOT_SHOW_CODES is "true"; never set it once a real SMS provider is used.
export function pilotCode(code: string | undefined): { pilotCode?: string } {
  return process.env.PILOT_SHOW_CODES === "true" && code ? { pilotCode: code } : {};
}
