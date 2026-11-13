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
      const every = invite.frequency === "DAILY" ? "every day but Sunday" : invite.frequency === "WEEKLY" ? "every week" : "every month";
      const how = ussdCode() ? `Answer in the Novi app, or dial ${ussdCode()} from any phone (menu 4).` : "Open or install Novi to answer.";
      return `Novi: ${invite.organiserName} invites you to join "${invite.groupName}" (${amount} FCFA ${every}). ${how}`;
    }
    case "FR":
    case "EE": {
      const every = invite.frequency === "DAILY" ? "chaque jour sauf dimanche" : invite.frequency === "WEEKLY" ? "chaque semaine" : "chaque mois";
      const how = ussdCode()
        ? `Répondez dans l'appli Novi, ou composez ${ussdCode()} depuis tout téléphone (menu 4).`
        : "Ouvrez ou installez Novi pour répondre.";
      return `Novi : ${invite.organiserName} vous invite à rejoindre « ${invite.groupName} » (${amount} FCFA ${every}). ${how}`;
    }
  }
}

// D106: an MFI's officer opened the record she shared with it.
export function recordOpenedSms(language: Language, mfiName: string): string {
  switch (language) {
    case "EN":
      return `Novi: ${mfiName} opened your Novi record today.`;
    case "FR":
    case "EE":
      return `Novi : ${mfiName} a ouvert votre relevé Novi aujourd'hui.`;
  }
}

// D143: the MFI decided on her savings account.
export function savingsDecidedSms(language: Language, mfiName: string, open: boolean, ref: string): string {
  if (language === "EN")
    return open
      ? `Novi: ${mfiName} opened your savings account ${ref}. The part of your pot you chose will be placed there.`
      : `Novi: ${mfiName} did not open your savings account. Your whole pot will go to your phone.`;
  return open
    ? `Novi : ${mfiName} a ouvert votre compte d'épargne ${ref}. La part de votre cagnotte choisie y sera placée.`
    : `Novi : ${mfiName} n'a pas ouvert votre compte d'épargne. Toute votre cagnotte ira sur votre téléphone.`;
}

// D106: the USSD code, when one is set (USSD_CODE, e.g. *384*12345#), so an
// invitation can be answered from any phone, even without an account yet.
const ussdCode = () => process.env.USSD_CODE?.trim() || null;

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

// A reminder before a due date (F16). Short, with the amount and the day, so
// it is useful even on a basic phone without the app.
export function reminderSms(
  language: Language,
  reminder: { groupName: string; amountFcfa: number; date: string; dueToday: boolean },
): string {
  const amount = formatFcfa(reminder.amountFcfa);
  const [year, month, day] = reminder.date.split("-");
  const date = `${day}/${month}/${year}`;
  switch (language) {
    case "EN":
      return reminder.dueToday
        ? `Novi: today is the day for "${reminder.groupName}". Your ${amount} FCFA is due today.`
        : `Novi: reminder, your ${amount} FCFA for "${reminder.groupName}" is due tomorrow, ${date}.`;
    case "FR":
    case "EE":
      return reminder.dueToday
        ? `Novi : c'est aujourd'hui pour « ${reminder.groupName} ». Vos ${amount} FCFA sont à payer aujourd'hui.`
        : `Novi : rappel, vos ${amount} FCFA pour « ${reminder.groupName} » sont à payer demain, le ${date}.`;
  }
}

// A payment that failed or was never confirmed by the operator. Kept short:
// she checks her balance and answers in the app, or pays again (D104 screens).
export function failedSms(
  language: Language,
  failed: { amountFcfa: number; roundNumber: number; groupName: string; ref: string },
): string {
  const amount = formatFcfa(failed.amountFcfa);
  switch (language) {
    case "EN":
      return `Novi: your payment of ${amount} FCFA for round ${failed.roundNumber} of "${failed.groupName}" is not confirmed. Ref. ${failed.ref}. Open Novi to say whether the money left your account.`;
    case "FR":
    case "EE":
      return `Novi : votre paiement de ${amount} FCFA pour le tour ${failed.roundNumber} de « ${failed.groupName} » n'est pas confirmé. Réf. ${failed.ref}. Ouvrez Novi pour dire si l'argent a quitté votre compte.`;
  }
}

// D105: the MFI checked the operator's statement and did not find her payment.
export function notFoundSms(
  language: Language,
  found: { amountFcfa: number; roundNumber: number; groupName: string; mfiName: string },
): string {
  const amount = formatFcfa(found.amountFcfa);
  switch (language) {
    case "EN":
      return `Novi: ${found.mfiName} did not find your payment of ${amount} FCFA for round ${found.roundNumber} of "${found.groupName}". Please pay again in Novi.`;
    case "FR":
    case "EE":
      return `Novi : ${found.mfiName} n'a pas trouvé votre paiement de ${amount} FCFA pour le tour ${found.roundNumber} de « ${found.groupName} ». Payez à nouveau dans Novi.`;
  }
}

// D104: her share was covered by the group's advances; what she repays, by when.
export function coverSms(
  language: Language,
  cover: { amountFcfa: number; roundNumber: number; groupName: string; dueBy: string },
): string {
  const amount = formatFcfa(cover.amountFcfa);
  const [year, month, day] = cover.dueBy.split("-");
  switch (language) {
    case "EN":
      return `Novi: the group's advances paid your ${amount} FCFA for round ${cover.roundNumber} of "${cover.groupName}". Repay it before ${day}/${month}/${year}.`;
    case "FR":
    case "EE":
      return `Novi : les avances du groupe ont payé vos ${amount} FCFA pour le tour ${cover.roundNumber} de « ${cover.groupName} ». À rembourser avant le ${day}/${month}/${year}.`;
  }
}

// D149: what was left of the group's advances reached her at the end of the cycle.
export function advanceBackSms(language: Language, back: { amountFcfa: number; groupName: string }): string {
  const amount = formatFcfa(back.amountFcfa);
  switch (language) {
    case "EN":
      return `Novi: "${back.groupName}" is over. Your share of the group's advances, ${amount} FCFA, was sent to your mobile money.`;
    case "FR":
    case "EE":
      return `Novi : « ${back.groupName} » est terminé. Votre part des avances du groupe, ${amount} FCFA, a été envoyée sur votre mobile money.`;
  }
}
