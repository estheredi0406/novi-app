import type { Language } from "../generated/prisma/enums.js";

// SMS go straight to the phone's inbox, where nothing translates them, so the
// server writes them in the member's language. Ewe texts are pending review by
// a native speaker; French is used for Ewe until then.

export function otpSms(language: Language, code: string): string {
  switch (language) {
    case "EN":
      return `Novi: your code is ${code}. It expires in 5 minutes. Never share it with anyone.`;
    case "FR":
    case "EE":
      return `Novi : votre code est ${code}. Il expire dans 5 minutes. Ne le partagez avec personne.`;
  }
}

export function alreadyRegisteredSms(language: Language): string {
  switch (language) {
    case "EN":
      return "Novi: someone tried to create an account with this number, which already has one. If it was you, log in instead.";
    case "FR":
    case "EE":
      return "Novi : quelqu'un a voulu créer un compte avec ce numéro, qui en a déjà un. Si c'était vous, connectez-vous.";
  }
}