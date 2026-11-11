import type { SmsProvider } from "./SmsProvider.js";

// Sends real SMS through Twilio's Messages API, to Togo (and to Rwanda for the
// pilot run from Kigali). Chosen when SMS_PROVIDER=twilio and its keys are set;
// otherwise the mock is used (D3). Prices checked on Twilio's site: about
// 0.49 USD per SMS to Togo, 0.33 USD to Rwanda.
export class TwilioSmsProvider implements SmsProvider {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string, // a Twilio number, or a Messaging Service SID (MG...)
  ) {}

  async send(to: string, text: string): Promise<void> {
    const body = new URLSearchParams({ To: to, Body: toGsm(text) });
    if (this.from.startsWith("MG")) body.set("MessagingServiceSid", this.from);
    else body.set("From", this.from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio refused the SMS (${res.status}): ${detail.slice(0, 200)}`);
    }
  }
}

// A character outside the GSM alphabet makes the whole SMS cost up to three
// times more (it then holds 70 characters instead of 160). French needs é, è,
// à, ù, which GSM has; the rest is replaced by its nearest GSM character.
const REPLACE: Record<string, string> = {
  "«": '"',
  "»": '"',
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "\u00a0": " ", // no-break space, as in "5 000"
  "\u202f": " ", // narrow no-break space
  "–": "-",
  "—": "-",
  "…": "...",
  ê: "e",
  ë: "e",
  â: "a",
  î: "i",
  ï: "i",
  ô: "o",
  û: "u",
  ç: "c",
  Ê: "E",
  È: "E",
  À: "A",
  Ô: "O",
  Î: "I",
  Â: "A",
};

export function toGsm(text: string): string {
  // D118: French guillemets keep a space inside (« Pagnes »); straight
  // quotes do not, or the SMS reads " Pagnes ".
  const tight = text.replace(/«[\s\u00a0\u202f]+/g, "«").replace(/[\s\u00a0\u202f]+»/g, "»");
  return [...tight].map((c) => REPLACE[c] ?? c).join("");
}
