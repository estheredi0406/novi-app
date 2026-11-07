// Sends a text message to a phone number. The demo uses MockSmsProvider.
// Production needs a provider that delivers to Togolese numbers: Africa's
// Talking does not list Togo among its live countries, so a Togolese SMS
// provider is the expected route (D3).
// send resolves to true only when a real SMS was handed to an operator, so
// the pilot can stop showing a code on screen that the phone really received.
export interface SmsProvider {
  send(to: string, text: string): Promise<boolean | void>;
}