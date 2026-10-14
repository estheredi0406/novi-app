// Sends a text message to a phone number. The demo uses MockSmsProvider;
// production needs a Togolese SMS provider, since Africa's Talking does not
// serve Togo in production (D3).
export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}