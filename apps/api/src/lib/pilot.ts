// Pilot mode (D61). While SMS is still a mock and real SMS to Togo costs
// about 0.49 USD each, the online pilot returns each one-time code in the API
// response, and the app shows it on screen with a "pilot" label. Off unless
// PILOT_SHOW_CODES is "true". A code that really reached her phone by SMS
// (a Rwandan tester's number through Pindo, D111) is never shown: the screen
// would let anyone holding the phone in without the SMS, which is the very
// thing the code checks.
export function pilotCode(code: string | undefined, delivered: boolean | void = false): { pilotCode?: string } {
  return process.env.PILOT_SHOW_CODES === "true" && code && delivered !== true ? { pilotCode: code } : {};
}

// D73: while the USSD channel is Africa's Talking's sandbox, only the test
// accounts may use it: a real member's PIN is typed only on her own phone.
export function pilotMode(): boolean {
  return process.env.PILOT_SHOW_CODES === "true";
}
