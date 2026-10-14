// Sends a text message to a phone number. The demo uses MockSmsProvider.
// Production needs a provider that delivers to Togolese numbers: Africa's
// Talking does not list Togo among its live countries, so a Togolese SMS
// provider is the expected route (D3).
export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}