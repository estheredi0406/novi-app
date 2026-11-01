// D90: email to MFI staff, so an officer who is not looking at the console
// still hears that something waits for him. Members are never emailed: they
// have no email, and get phone notifications instead (D79).
export type EmailMessage = {
  to: { email: string; name?: string }[];
  subject: string;
  text: string;
  html: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
