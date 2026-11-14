// Sends an SMS. send() returns true only when a real SMS left, so the pilot
// knows when it can stop showing the code on screen (D3).
export interface SmsProvider {
  send(to: string, text: string): Promise<boolean | void>;
}