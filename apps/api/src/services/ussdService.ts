import type { GroupSummary } from "@novi/shared";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { checkPin } from "./authService.js";
import { listMyGroups } from "./groupService.js";
import { payRound } from "./moneyService.js";
import { buildRecord } from "./recordService.js";

// Novi by USSD (D73), for a member whose phone has no internet or no apps:
// she dials a short code, and her phone shows short menus she answers with
// the keypad. The operator's gateway sends, at each step, the session, her
// number (which the operator vouches for) and everything she typed so far,
// joined by "*"; Novi answers "CON <text>" to show a menu and wait, or
// "END <text>" to close. This is the common gateway convention (used by
// aggregators such as Africa's Talking), so a real code can be connected
// later without changing the menus. Until an operator in Togo gives Novi a
// code, the channel is Africa's Talking's sandbox (routes/ussd.ts).
//
// Every session starts with her PIN, checked with the same lockout as the
// app (D18). Each screen stays under 160 characters, the size of a USSD
// screen on a basic phone.

export type UssdReply = { text: string; end: boolean };

const con = (text: string): UssdReply => ({ text, end: false });
const end = (text: string): UssdReply => ({ text, end: true });

type Lang = "fr" | "en";
const T = {
  fr: {
    unknown: "Ce numéro n'a pas de compte Novi. Inscrivez-vous dans l'application ou en agence.",
    closed: "Ce compte est clôturé. Rendez-vous en agence.",
    pin: "Novi\nEntrez votre code PIN :",
    badPin: "Code PIN incorrect.",
    locked: (min: number) => `Trop d'essais. Réessayez dans ${min} min.`,
    menu: "Novi\n1. Payer ma cotisation\n2. Mes groupes\n3. Mon relevé (ACEV)\n0. Quitter",
    bye: "Merci d'utiliser Novi.",
    invalid: "Choix invalide.",
    nothingToPay: "Rien à payer cette semaine. Merci !",
    choosePay: "Payer pour :",
    confirmPay: (amount: string, group: string, round: number) =>
      `Payer ${amount} à ${group}, tour ${round} ?\n1. Moov Africa\n2. Yas (Togocel)\n0. Annuler`,
    paySent: (amount: string) =>
      `Demande de ${amount} envoyée. Validez-la avec le code de votre compte Mobile Money. Reçu par SMS.`,
    payFailed: "Le paiement n'a pas pu être lancé. Réessayez plus tard.",
    noGroups: "Vous n'avez pas encore de groupe.",
    groupLine: (g: GroupSummary) => {
      const r = g.currentRound;
      if (!r) return `${g.name} : pas en cours`;
      const paid = r.myStatus === "PAID" ? "payé" : r.myStatus === "PENDING" ? "en cours" : "à payer";
      const turn = r.isMyTurn ? "c'est votre tour" : r.myTurn ? `votre tour : ${short(r.myTurn.dueDate)}` : "";
      return `${g.name} : tour ${r.number} ${paid}${turn ? `, ${turn}` : ""}`;
    },
    record: (onTime: number, saved: string, pots: number, cycles: number) =>
      `Votre relevé Novi\nÀ l'heure : ${onTime} %\nÉpargné : ${saved}\nCagnottes reçues : ${pots}\nCycles terminés : ${cycles}`,
  },
  en: {
    unknown: "This number has no Novi account. Sign up in the app or at an agency.",
    closed: "This account is closed. Please visit an agency.",
    pin: "Novi\nEnter your PIN:",
    badPin: "Wrong PIN.",
    locked: (min: number) => `Too many tries. Try again in ${min} min.`,
    menu: "Novi\n1. Pay my contribution\n2. My groups\n3. My record (ACEV)\n0. Quit",
    bye: "Thank you for using Novi.",
    invalid: "Invalid choice.",
    nothingToPay: "Nothing to pay this week. Thank you!",
    choosePay: "Pay for:",
    confirmPay: (amount: string, group: string, round: number) =>
      `Pay ${amount} to ${group}, round ${round}?\n1. Moov Africa\n2. Yas (Togocel)\n0. Cancel`,
    paySent: (amount: string) => `Request for ${amount} sent. Approve it with your Mobile Money code. Receipt by SMS.`,
    payFailed: "The payment could not be started. Try again later.",
    noGroups: "You have no group yet.",
    groupLine: (g: GroupSummary) => {
      const r = g.currentRound;
      if (!r) return `${g.name}: not running`;
      const paid = r.myStatus === "PAID" ? "paid" : r.myStatus === "PENDING" ? "pending" : "to pay";
      const turn = r.isMyTurn ? "your turn" : r.myTurn ? `your turn: ${short(r.myTurn.dueDate)}` : "";
      return `${g.name}: round ${r.number} ${paid}${turn ? `, ${turn}` : ""}`;
    },
    record: (onTime: number, saved: string, pots: number, cycles: number) =>
      `Your Novi record\nOn time: ${onTime}%\nSaved: ${saved}\nPots received: ${pots}\nCycles completed: ${cycles}`,
  },
} as const;

// "2026-11-06" becomes "06/11".
function short(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}
const fcfa = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} F`;
const MAX_SCREEN = 160;
const fit = (text: string) => (text.length <= MAX_SCREEN ? text : `${text.slice(0, MAX_SCREEN - 1)}…`);

export async function handleUssd(input: { phone: string; text: string }): Promise<UssdReply> {
  const reply = await answer(input);
  return { ...reply, text: fit(reply.text) };
}

async function answer({ phone, text }: { phone: string; text: string }): Promise<UssdReply> {
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return end(T.fr.unknown);
  const t = T[(user.language === "EN" ? "en" : "fr") satisfies Lang];
  if (user.closedAt) return end(t.closed);

  const steps = text === "" ? [] : text.split("*");
  const [pin, choice, ...rest] = steps;
  if (pin === undefined) return con(t.pin);

  try {
    await checkPin(user, pin);
  } catch (err) {
    if (err instanceof AppError && err.code === "PIN_LOCKED") {
      return end(t.locked(Math.ceil((err.retryAfterSec ?? 900) / 60)));
    }
    return end(t.badPin);
  }
  if (choice === undefined) return con(t.menu);
  if (choice === "0") return end(t.bye);

  if (choice === "1") {
    const groups = (await listMyGroups(user.id)).filter(
      (g) => g.currentRound && (g.currentRound.myStatus === "UNPAID" || g.currentRound.myStatus === "FAILED"),
    );
    if (groups.length === 0) return end(t.nothingToPay);
    const [pick, operator] = rest;
    if (pick === undefined) {
      return con(`${t.choosePay}\n${groups.map((g, i) => `${i + 1}. ${g.name} ${fcfa(g.amountFcfa)}`).join("\n")}`);
    }
    const group = groups[Number(pick) - 1];
    if (!group?.currentRound) return end(t.invalid);
    if (operator === undefined) return con(t.confirmPay(fcfa(group.amountFcfa), group.name, group.currentRound.number));
    if (operator === "0") return end(t.bye);
    if (operator !== "1" && operator !== "2") return end(t.invalid);
    try {
      await payRound(group.id, user.id, group.currentRound.number, operator === "1" ? "MOOV_TG" : "TOGOCEL");
      await prisma.auditEvent.create({
        data: { userId: user.id, type: "USSD_PAYMENT_REQUESTED", details: { groupId: group.id } },
      });
      return end(t.paySent(fcfa(group.amountFcfa)));
    } catch {
      return end(t.payFailed);
    }
  }

  if (choice === "2") {
    const groups = await listMyGroups(user.id);
    if (groups.length === 0) return end(t.noGroups);
    return end(groups.map(t.groupLine).join("\n"));
  }

  if (choice === "3") {
    const record = await buildRecord(user.id);
    return end(
      t.record(record.onTimeRate ?? 0, fcfa(record.totalSavedFcfa), record.potsReceived, record.groupsCompleted),
    );
  }
  return end(t.invalid);
}
