import type { Frequency, Language } from "../generated/prisma/enums.js";

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

// "5000" becomes "5 000", the way amounts are written in Togo.
function formatFcfa(amount: number): string {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// The same text goes to a number with or without a Novi account, so the SMS
// itself never reveals whether the person already uses Novi (D38).
export function inviteSms(
  language: Language,
  invite: { organiserName: string; groupName: string; amountFcfa: number; frequency: Frequency },
): string {
  const amount = formatFcfa(invite.amountFcfa);
  switch (language) {
    case "EN": {
      const every = invite.frequency === "WEEKLY" ? "every week" : "every month";
      return `Novi: ${invite.organiserName} invites you to join "${invite.groupName}" (${amount} FCFA ${every}). Open or install Novi to answer.`;
    }
    case "FR":
    case "EE": {
      const every = invite.frequency === "WEEKLY" ? "chaque semaine" : "chaque mois";
      return `Novi : ${invite.organiserName} vous invite à rejoindre « ${invite.groupName} » (${amount} FCFA ${every}). Ouvrez ou installez Novi pour répondre.`;
    }
  }
}

// Sent once a payment is confirmed: her proof of payment, even without data.
export function receiptSms(
  language: Language,
  receipt: { amountFcfa: number; roundNumber: number; groupName: string; date: string; ref: string; mfiName: string },
): string {
  const amount = formatFcfa(receipt.amountFcfa);
  const [year, month, day] = receipt.date.split("-");
  switch (language) {
    case "EN":
      return `Novi: payment received. ${amount} FCFA for round ${receipt.roundNumber} of "${receipt.groupName}" on ${day}/${month}/${year}. Ref. ${receipt.ref}. Money held at ${receipt.mfiName}.`;
    case "FR":
    case "EE":
      return `Novi : paiement reçu. ${amount} FCFA pour le tour ${receipt.roundNumber} de « ${receipt.groupName} » le ${day}/${month}/${year}. Réf. ${receipt.ref}. Argent conservé chez ${receipt.mfiName}.`;
  }
}

// Sent once the MFI confirms the pot reached her wallet.
export function payoutSms(
  language: Language,
  payout: { amountFcfa: number; roundNumber: number; groupName: string; date: string; mfiName: string },
): string {
  const amount = formatFcfa(payout.amountFcfa);
  const [year, month, day] = payout.date.split("-");
  switch (language) {
    case "EN":
      return `Novi: you have received ${amount} FCFA, the pot of round ${payout.roundNumber} of "${payout.groupName}", on ${day}/${month}/${year}. Sent by ${payout.mfiName}.`;
    case "FR":
    case "EE":
      return `Novi : vous avez reçu ${amount} FCFA, la cagnotte du tour ${payout.roundNumber} de « ${payout.groupName} », le ${day}/${month}/${year}. Envoyé par ${payout.mfiName}.`;
  }
}
