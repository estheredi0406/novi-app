import { advanceOf } from "../lib/groupRules.js";
import type { Frequency, GroupSummary, LoanCheck, LoanPage, LoanPurpose } from "@novi/shared";
import type { User } from "../generated/prisma/client.js";
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { acceptedPhone } from "../lib/phone.js";
import { isWeakPin } from "../lib/pinRules.js";
import { remember, sawExactly } from "../lib/ussdScreens.js";
import { sms } from "../providers/index.js";
import { checkPin, registerByUssd } from "./authService.js";
import { acceptRules, declineGroup, listMyGroups, listMyInvitations } from "./group/index.js";
import { answerSwap } from "./helpService.js";
import { confirmUssdIdentity, dateFromKeypad, niuFromKeypad, startUssdIdentity } from "./identityService.js";
import { payRound } from "./moneyService.js";
import { getLoanPage, requestLoan } from "./loanService.js";
import { buildRecord, listLenders, listShares, revokeShare, shareRecord } from "./recordService.js";

// Novi by USSD (D73), for phones without internet: she dials a code and answers
// short menus with the keypad. We answer "CON <text>" to continue or "END <text>"
// to close, the usual gateway convention, so a real code can be plugged in later.
// Each session starts with her PIN (same lockout as the app, D18) and each
// screen stays under 160 characters.
// D106: she can even sign up here alone, without a smartphone.

export type UssdReply = { text: string; end: boolean };

const con = (text: string): UssdReply => ({ text, end: false });
const end = (text: string): UssdReply => ({ text, end: true });

type Lang = "fr" | "en";
const T = {
  fr: {
    closed: "Ce compte est clôturé. Rendez-vous en agence.",
    foreign: "Novi est réservé aux numéros du Togo.",
    pin: "Novi\nEntrez votre code PIN :",
    badPin: "Code PIN incorrect.",
    locked: (min: number) => `Trop d'essais. Réessayez dans ${min} min.`,
    menu: (waiting: number) =>
      `Novi\n1. Payer ma cotisation\n2. Mes groupes\n3. Mon relevé (ACEV)\n4. À répondre${waiting ? ` (${waiting})` : ""}\n5. Mes données\n6. Crédit\n0. Quitter`,
    bye: "Merci d'utiliser Novi.",
    invalid: "Choix invalide.",
    nothingToPay: "Rien à payer cette semaine. Merci !",
    choosePay: "Payer pour :",
    confirmPay: (amount: string, group: string, round: number) =>
      `Payer ${amount} à ${group}, tour ${round} ?\n1. Moov Africa\n2. Yas (Togocel)\n0. Annuler`,
    paySent: (amount: string) =>
      `Demande de ${amount} envoyée. Validez-la avec le code de votre compte Mobile Money. Reçu par SMS.`,
    payFailed: "Le paiement n'a pas pu être lancé. Réessayez plus tard.",
    payChanged: "Ce paiement a changé entre-temps. Rien n'est payé. Recomposez le code pour voir le montant à jour.",
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
    // D165: her latest movements, as the MFI's books hold them (D113)
    recordMore: "1. Derniers mouvements\n0. Quitter",
    noMoves: "Aucun mouvement pour l'instant.",
    moves: "Derniers mouvements :",
    movePaid: (day: string, amount: string, group: string) => `${day} payé ${amount} ${group}`,
    movePot: (day: string, amount: string, group: string) => `${day} reçu ${amount} ${group}`,
    // D106: menu 4
    nothingToAnswer: "Rien n'attend votre réponse.",
    toAnswer: "À répondre :",
    itemInvite: (group: string) => `Invitation : ${group}`,
    itemRules: (group: string) => `Règles changées : ${group}`,
    itemSwap: (name: string) => `Échange de tour : ${name}`,
    inviteDetail: (who: string, group: string, amount: string, every: string, size: number, mfi: string) =>
      `${who} : « ${group} »\n${amount} ${every}, ${size} membres\nArgent chez ${mfi}\n1. Accepter\n2. Refuser\n0. Quitter`,
    rulesDetail: (group: string, amount: string, every: string, size: number, mfi: string) =>
      `Nouvelles règles « ${group} »\n${amount} ${every}, ${size} membres\nArgent chez ${mfi}\n1. Accepter\n2. Refuser\n0. Quitter`,
    swapDetail: (name: string, group: string, mine: number, theirs: number) =>
      `${name} (${group}) propose : vous prenez son tour ${theirs}, elle prend votre tour ${mine}.\n1. Accepter\n2. Refuser\n0. Quitter`,
    shareAsk: (mfi: string) =>
      `Pendant qu'elle vérifie le groupe, ${mfi} peut voir votre relevé Novi. C'est facultatif.\n1. D'accord\n2. Non merci`,
    accepted: "C'est noté : vous avez accepté. Le groupe démarre quand tout le monde a répondu.",
    declined: "C'est noté : vous avez refusé. Le groupe ne voit pas votre nom.",
    swapYes: "Échange accepté. L'organisatrice le confirme.",
    swapNo: "Échange refusé. Vous gardez votre tour.",
    limit: "Vous êtes déjà dans 3 groupes. Terminez-en un avant d'en rejoindre un autre.",
    owing: "Remboursez d'abord ce que vous devez à votre groupe.",
    notNow: "Ce n'est plus possible. Les règles ont peut-être changé : rouvrez le menu 4.",
    every: { DAILY: "chaque jour", WEEKLY: "par semaine", MONTHLY: "par mois" } as Record<Frequency, string>,
    // D106: menu 5
    myData: (legal: string, display: string) =>
      `Mes données\nNom : ${legal}\nDans le groupe : ${display}\n1. Partager mon relevé\n2. Qui l'a vu\n3. Retirer un partage\n0. Quitter`,
    shareWith: "Partager avec :",
    // D165: she confirms before sharing, and can withdraw by USSD too
    shareConfirm: (mfi: string) =>
      `${mfi} pourra voir votre relevé Novi pendant 30 jours. Vous pouvez le retirer au menu 5.\n1. Partager\n0. Annuler`,
    noShares: "Aucun partage en cours.",
    revokeWhich: "Retirer le partage avec :",
    revoked: (mfi: string) => `Partage retiré : ${mfi} ne voit plus votre relevé.`,
    shared: (mfi: string, until: string) => `Relevé partagé avec ${mfi} jusqu'au ${until}. Vous recevez un SMS à chaque ouverture.`,
    sharedSms: (mfi: string, until: string) =>
      `Novi : votre relevé est partagé avec ${mfi} jusqu'au ${until}. Pour le retirer : menu 5 du code Novi, l'app ou l'agence.`,
    noViews: "Personne n'a encore ouvert votre relevé.",
    views: "Ont ouvert votre relevé :",
    // D165: menu 6, asking for a loan; her business is seen at the agency
    loanOff: "Votre caisse ne propose pas encore de crédit par Novi.",
    loanPending: (amount: string, mfi: string) => `Votre demande de ${amount} est à l'étude chez ${mfi}. Réponse par SMS.`,
    loanShortlisted: (mfi: string, docs: string) => `Demande retenue. Passez signer chez ${mfi} avec : ${docs}`,
    loanDocsBySms: (mfi: string) => `Demande retenue. Passez signer chez ${mfi}. La liste des pièces à apporter vous est envoyée par SMS.`,
    loanDocsSms: (mfi: string, docs: string) => `Novi : pour signer votre crédit chez ${mfi}, apportez : ${docs}.`,
    loanWhy: {
      CYCLE_OR_STREAK: (f: Record<string, number>) =>
        `Pas encore : terminez un cycle, ou payez ${f.minStreak} fois de suite à l'heure (vous : ${f.streak}).`,
      ON_TIME: (f: Record<string, number>, need: number | null) =>
        `Pas encore : il faut ${f.min} % de paiements à l'heure (vous : ${f.percent} %).${need ? ` Encore ${need} à l'heure.` : ""}`,
      NO_DEBT: () => "Remboursez d'abord ce que vous devez à votre groupe : votre prochain paiement s'en charge.",
      NO_OPEN_REQUEST: () => "Vous avez déjà une demande en cours.",
      WAIT_AFTER_REFUSAL: (f: Record<string, number>) => `Nouvelle demande possible dans ${(f.wait ?? 0) - (f.days ?? 0)} jours.`,
      SAVINGS: () => "Votre caisse demande d'abord une épargne chez elle. Passez en agence.",
      CEILING: () => "Pas encore possible.",
    } as Record<LoanCheck["key"], (f: Record<string, number>, need: number | null) => string>,
    loanAmount: (mfi: string, ceiling: string) => `Crédit chez ${mfi}\nJusqu'à ${ceiling}.\nMontant voulu, en francs :`,
    loanBadAmount: (ceiling: string) => `Montant non valable : de 1 000 à ${ceiling}. Recomposez le code.`,
    loanPurpose: "Pour quoi ?\n1. Marchandises\n2. Équipement\n3. Autre",
    purposes: { STOCK: "marchandises", EQUIPMENT: "équipement", OTHER: "autre" } as Record<LoanPurpose, string>,
    loanConfirm: (amount: string, mfi: string, purpose: string) =>
      `Demander ${amount} à ${mfi} (${purpose}) ? L'agent verra votre relevé et parlera de votre commerce avec vous.\n1. Envoyer\n0. Annuler`,
    loanSent: (mfi: string) => `Demande envoyée à ${mfi}. Réponse par SMS. Pour signer, ce sera à l'agence.`,
  },
  en: {
    closed: "This account is closed. Please visit an agency.",
    foreign: "Novi is for Togolese numbers only.",
    pin: "Novi\nEnter your PIN:",
    badPin: "Wrong PIN.",
    locked: (min: number) => `Too many tries. Try again in ${min} min.`,
    menu: (waiting: number) =>
      `Novi\n1. Pay my contribution\n2. My groups\n3. My record (ACEV)\n4. To answer${waiting ? ` (${waiting})` : ""}\n5. My data\n6. Loan\n0. Quit`,
    bye: "Thank you for using Novi.",
    invalid: "Invalid choice.",
    nothingToPay: "Nothing to pay this week. Thank you!",
    choosePay: "Pay for:",
    confirmPay: (amount: string, group: string, round: number) =>
      `Pay ${amount} to ${group}, round ${round}?\n1. Moov Africa\n2. Yas (Togocel)\n0. Cancel`,
    paySent: (amount: string) => `Request for ${amount} sent. Approve it with your Mobile Money code. Receipt by SMS.`,
    payFailed: "The payment could not be started. Try again later.",
    payChanged: "This payment changed in the meantime. Nothing was paid. Dial the code again to see the amount now due.",
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
    recordMore: "1. Latest movements\n0. Quit",
    noMoves: "No movement yet.",
    moves: "Latest movements:",
    movePaid: (day: string, amount: string, group: string) => `${day} paid ${amount} ${group}`,
    movePot: (day: string, amount: string, group: string) => `${day} got ${amount} ${group}`,
    nothingToAnswer: "Nothing is waiting for your answer.",
    toAnswer: "To answer:",
    itemInvite: (group: string) => `Invitation: ${group}`,
    itemRules: (group: string) => `New rules: ${group}`,
    itemSwap: (name: string) => `Turn swap: ${name}`,
    inviteDetail: (who: string, group: string, amount: string, every: string, size: number, mfi: string) =>
      `${who}: "${group}"\n${amount} ${every}, ${size} members\nMoney at ${mfi}\n1. Accept\n2. Decline\n0. Quit`,
    rulesDetail: (group: string, amount: string, every: string, size: number, mfi: string) =>
      `New rules "${group}"\n${amount} ${every}, ${size} members\nMoney at ${mfi}\n1. Accept\n2. Decline\n0. Quit`,
    swapDetail: (name: string, group: string, mine: number, theirs: number) =>
      `${name} (${group}) offers: you take her turn ${theirs}, she takes your turn ${mine}.\n1. Accept\n2. Decline\n0. Quit`,
    shareAsk: (mfi: string) =>
      `While it checks the group, ${mfi} may see your Novi record. This is optional.\n1. I agree\n2. No thanks`,
    accepted: "Noted: you accepted. The group starts once everyone has answered.",
    declined: "Noted: you declined. The group does not see your name.",
    swapYes: "Swap accepted. The organiser confirms it.",
    swapNo: "Swap declined. You keep your turn.",
    limit: "You are already in 3 groups. Finish one before joining another.",
    owing: "First repay what you owe your group.",
    notNow: "This is no longer possible. The rules may have changed: open menu 4 again.",
    every: { DAILY: "a day", WEEKLY: "a week", MONTHLY: "a month" } as Record<Frequency, string>,
    myData: (legal: string, display: string) =>
      `My data\nName: ${legal}\nIn the group: ${display}\n1. Share my record\n2. Who saw it\n3. Withdraw a share\n0. Quit`,
    shareWith: "Share with:",
    shareConfirm: (mfi: string) =>
      `${mfi} will be able to see your Novi record for 30 days. You can withdraw it in menu 5.\n1. Share\n0. Cancel`,
    noShares: "No share running.",
    revokeWhich: "Withdraw the share with:",
    revoked: (mfi: string) => `Share withdrawn: ${mfi} no longer sees your record.`,
    shared: (mfi: string, until: string) => `Record shared with ${mfi} until ${until}. You get an SMS each time it is opened.`,
    sharedSms: (mfi: string, until: string) =>
      `Novi: your record is shared with ${mfi} until ${until}. To withdraw it: menu 5 of the Novi code, the app or the agency.`,
    noViews: "Nobody has opened your record yet.",
    views: "Opened your record:",
    loanOff: "Your caisse does not offer loans through Novi yet.",
    loanPending: (amount: string, mfi: string) => `Your request for ${amount} is being studied by ${mfi}. Answer by SMS.`,
    loanShortlisted: (mfi: string, docs: string) => `Request shortlisted. Come and sign at ${mfi} with: ${docs}`,
    loanDocsBySms: (mfi: string) => `Request shortlisted. Come and sign at ${mfi}. The list of documents to bring is sent to you by SMS.`,
    loanDocsSms: (mfi: string, docs: string) => `Novi: to sign your loan at ${mfi}, bring: ${docs}.`,
    loanWhy: {
      CYCLE_OR_STREAK: (f: Record<string, number>) =>
        `Not yet: finish a cycle, or pay on time ${f.minStreak} times in a row (you: ${f.streak}).`,
      ON_TIME: (f: Record<string, number>, need: number | null) =>
        `Not yet: ${f.min}% of payments must be on time (you: ${f.percent}%).${need ? ` ${need} more on time.` : ""}`,
      NO_DEBT: () => "First repay what you owe your group: your next payment takes care of it.",
      NO_OPEN_REQUEST: () => "You already have a request running.",
      WAIT_AFTER_REFUSAL: (f: Record<string, number>) => `New request possible in ${(f.wait ?? 0) - (f.days ?? 0)} days.`,
      SAVINGS: () => "Your caisse first asks for savings with it. Visit an agency.",
      CEILING: () => "Not possible yet.",
    } as Record<LoanCheck["key"], (f: Record<string, number>, need: number | null) => string>,
    loanAmount: (mfi: string, ceiling: string) => `Loan from ${mfi}\nUp to ${ceiling}.\nAmount wanted, in francs:`,
    loanBadAmount: (ceiling: string) => `Amount not valid: from 1 000 to ${ceiling}. Dial the code again.`,
    loanPurpose: "What for?\n1. Goods to sell\n2. Equipment\n3. Other",
    purposes: { STOCK: "goods", EQUIPMENT: "equipment", OTHER: "other" } as Record<LoanPurpose, string>,
    loanConfirm: (amount: string, mfi: string, purpose: string) =>
      `Ask ${mfi} for ${amount} (${purpose})? The officer will see your record and talk about your business with you.\n1. Send\n0. Cancel`,
    loanSent: (mfi: string) => `Request sent to ${mfi}. Answer by SMS. Signing happens at the agency.`,
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

export async function handleUssd(input: { phone: string; text: string; sessionId?: string }): Promise<UssdReply> {
  const reply = await answer({ ...input, sessionId: input.sessionId ?? "" });
  return { ...reply, text: fit(reply.text) };
}

async function answer({ phone, text, sessionId }: { phone: string; text: string; sessionId: string }): Promise<UssdReply> {
  const steps = text === "" ? [] : text.split("*");
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return signUp(phone, steps, sessionId);
  const t = T[(user.language === "EN" ? "en" : "fr") satisfies Lang];
  if (user.closedAt) return end(t.closed);

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
  if (choice === undefined) return con(t.menu((await toAnswer(user)).length));
  if (choice === "0") return end(t.bye);

  if (choice === "1") {
    const groups = (await listMyGroups(user.id)).filter(
      (g) => g.currentRound && (g.currentRound.myStatus === "UNPAID" || g.currentRound.myStatus === "FAILED"),
    );
    if (groups.length === 0) return end(t.nothingToPay);
    // D103: round 1 also carries her advance, half a contribution.
    const due = (g: (typeof groups)[number]) =>
      g.amountFcfa + (g.currentRound?.number === 1 ? advanceOf(g.amountFcfa) : 0);
    const [pick, operator] = rest;
    if (pick === undefined) {
      return con(`${t.choosePay}\n${groups.map((g, i) => `${i + 1}. ${g.name} ${fcfa(due(g))}`).join("\n")}`);
    }
    const group = groups[Number(pick) - 1];
    if (!group?.currentRound) return end(t.invalid);
    // D164: what the confirmation screen showed is what she pays, or nothing.
    const shownPay = `${group.id}:${group.currentRound.number}:${due(group)}`;
    if (operator === undefined) {
      remember(sessionId, phone, `pay:${pick}`, shownPay);
      return con(t.confirmPay(fcfa(due(group)), group.name, group.currentRound.number));
    }
    if (operator === "0") return end(t.bye);
    if (operator !== "1" && operator !== "2") return end(t.invalid);
    if (!sawExactly(sessionId, phone, `pay:${pick}`, shownPay)) return end(t.payChanged);
    try {
      await payRound(group.id, user.id, group.currentRound.number, operator === "1" ? "MOOV_TG" : "TOGOCEL");
      await prisma.auditEvent.create({
        data: { userId: user.id, type: "USSD_PAYMENT_REQUESTED", details: { groupId: group.id } },
      });
      return end(t.paySent(fcfa(due(group))));
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
    const [sub] = rest;
    if (sub === undefined) {
      const record = await buildRecord(user.id);
      const summary = t.record(record.onTimeRate ?? 0, fcfa(record.totalSavedFcfa), record.potsReceived, record.groupsCompleted);
      return con(`${summary}\n${t.recordMore}`);
    }
    if (sub === "0") return end(t.bye);
    if (sub !== "1") return end(t.invalid);
    return end(await movements(user, t));
  }

  if (choice === "4") return answerMenu(user, t, rest, sessionId);
  if (choice === "5") return dataMenu(user, t, rest);
  if (choice === "6") return loanMenu(user, t, rest);
  return end(t.invalid);
}

type Text = (typeof T)[Lang];

// ---------- Menu 3: her latest movements (D165) ----------

// Her last four payments and pots, newest first, short enough for one screen:
// "06/11 payé 5 000 F Pagnes Assig".
async function movements(user: User, t: Text): Promise<string> {
  const group = { round: { select: { group: { select: { name: true } } } } };
  const [paid, pots] = await Promise.all([
    prisma.contribution.findMany({
      where: { userId: user.id, status: "PAID", paidAt: { not: null } },
      include: group,
      orderBy: { paidAt: "desc" },
      take: 4,
    }),
    prisma.payout.findMany({
      where: { beneficiaryId: user.id, status: "PAID", paidAt: { not: null } },
      include: group,
      orderBy: { paidAt: "desc" },
      take: 4,
    }),
  ]);
  const name = (g: string) => (g.length > 12 ? g.slice(0, 12) : g);
  const day = (d: Date) => short(d.toISOString().slice(0, 10));
  const lines = [
    ...paid.map((c) => ({ at: c.paidAt as Date, text: t.movePaid(day(c.paidAt as Date), fcfa(c.amountFcfa), name(c.round.group.name)) })),
    // What reached her phone: the part she kept in savings stays at the MFI (D123).
    ...pots.map((p) => ({
      at: p.paidAt as Date,
      text: t.movePot(day(p.paidAt as Date), fcfa(p.amountFcfa - (p.keptFcfa ?? 0)), name(p.round.group.name)),
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 4);
  if (lines.length === 0) return t.noMoves;
  return `${t.moves}\n${lines.map((l) => l.text).join("\n")}`;
}

// ---------- Menu 6: asking for a loan (D165) ----------

// The field showed that a loan is signed at the agency whatever the channel,
// so by USSD she only starts the request: amount and purpose. The officer
// sees her Novi record in the console and talks about her business with her.
async function loanMenu(user: User, t: Text, rest: string[]): Promise<UssdReply> {
  const page: LoanPage = await getLoanPage(user.id);
  const mfi = page.mfiName;
  if (!page.enabled || !mfi) return end(t.loanOff);
  const open = page.requests.find((r) => r.status === "PENDING" || r.status === "PRESELECTED");
  if (open?.status === "PENDING") return end(t.loanPending(fcfa(open.amountFcfa), open.mfiName));
  if (open?.status === "PRESELECTED") {
    const docs = open.toBring.join(", ");
    const screen = t.loanShortlisted(open.mfiName, docs);
    if (screen.length <= MAX_SCREEN) return end(screen);
    // Too long for one screen: the full list goes by SMS, where she keeps it.
    await sms.send(user.phone, t.loanDocsSms(open.mfiName, docs));
    return end(t.loanDocsBySms(open.mfiName));
  }
  if (!page.eligible) {
    const failed = page.checks.find((c) => !c.ok);
    return end(failed ? t.loanWhy[failed.key](failed.figures, page.onTimeNeeded) : t.loanOff);
  }

  const [amountTyped, purposeTyped, send] = rest;
  const ceiling = fcfa(page.ceilingFcfa);
  if (amountTyped === undefined) return con(t.loanAmount(mfi, ceiling));
  const amount = /^\d{1,9}$/.test(amountTyped) ? Number(amountTyped) : 0;
  if (amount < 1000 || amount > page.ceilingFcfa) return end(t.loanBadAmount(ceiling));
  if (purposeTyped === undefined) return con(t.loanPurpose);
  const purpose = ({ "1": "STOCK", "2": "EQUIPMENT", "3": "OTHER" } as const)[purposeTyped as "1" | "2" | "3"];
  if (!purpose) return end(t.invalid);
  if (send === undefined) return con(t.loanConfirm(fcfa(amount), mfi, t.purposes[purpose]));
  if (send === "0") return end(t.bye);
  if (send !== "1") return end(t.invalid);
  try {
    await requestLoan(user.id, { amountFcfa: amount, purpose });
    await prisma.auditEvent.create({ data: { userId: user.id, type: "USSD_LOAN_REQUESTED", details: { amountFcfa: amount } } });
    return end(t.loanSent(mfi));
  } catch {
    return end(t.notNow);
  }
}

// ---------- Menu 4: what waits for her answer (D106) ----------

type Waiting =
  | {
      kind: "INVITE" | "RULES";
      groupId: string;
      group: string;
      organiser: string;
      amountFcfa: number;
      frequency: Frequency;
      size: number;
      mfi: string;
      version: number;
    }
  | { kind: "SWAP"; groupId: string; swapId: string; group: string; from: string; mine: number; theirs: number };

async function toAnswer(user: User): Promise<Waiting[]> {
  const invites = await listMyInvitations(user.id);
  const items: Waiting[] = [];
  for (const i of invites) {
    const g = await prisma.group.findUniqueOrThrow({ where: { id: i.groupId }, select: { currentVersion: true } });
    items.push({
      kind: "INVITE",
      groupId: i.groupId,
      group: i.groupName,
      organiser: i.organiserName,
      amountFcfa: i.rules.amountFcfa,
      frequency: i.rules.frequency,
      size: i.rules.size,
      mfi: i.mfiName,
      version: g.currentVersion,
    });
  }
  // A seat whose rules changed after she said yes: she answers again (D29).
  const seats = await prisma.membership.findMany({
    where: { userId: user.id, state: "INVITED", group: { state: { in: ["DRAFT", "PROPOSED"] }, organiserId: { not: user.id } } },
    include: { group: { include: { mfi: true, rulesVersions: true } } },
  });
  for (const seat of seats) {
    if (items.some((i) => i.groupId === seat.groupId)) continue;
    const rules = seat.group.rulesVersions.find((v) => v.version === seat.group.currentVersion);
    if (!rules) continue;
    items.push({
      kind: "RULES",
      groupId: seat.groupId,
      group: seat.group.name,
      organiser: "",
      amountFcfa: rules.amountFcfa,
      frequency: rules.frequency,
      size: rules.size,
      mfi: seat.group.mfi.name,
      version: seat.group.currentVersion,
    });
  }
  const swaps = await prisma.turnSwap.findMany({
    where: { partnerId: user.id, status: "ASKED" },
    include: { group: { select: { name: true } }, requester: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const swap of swaps) {
    items.push({
      kind: "SWAP",
      groupId: swap.groupId,
      swapId: swap.id,
      group: swap.group.name,
      from: swap.requester.displayName,
      mine: swap.partnerRound,
      theirs: swap.requesterRound,
    });
  }
  return items;
}

function refusal(t: Text, err: unknown): UssdReply {
  const code = err instanceof AppError ? err.code : "";
  if (code === "GROUP_LIMIT_REACHED") return end(t.limit);
  if (code === "DEBT_OUTSTANDING") return end(t.owing);
  return end(t.notNow);
}

async function answerMenu(user: User, t: Text, rest: string[], sessionId: string): Promise<UssdReply> {
  const items = await toAnswer(user);
  if (items.length === 0) return end(t.nothingToAnswer);
  const [pick, action, extra] = rest;
  const label = (i: Waiting) =>
    i.kind === "SWAP" ? t.itemSwap(i.from) : i.kind === "RULES" ? t.itemRules(i.group) : t.itemInvite(i.group);
  if (pick === undefined) return con(`${t.toAnswer}\n${items.map((i, n) => `${n + 1}. ${label(i)}`).join("\n")}`);
  const item = items[Number(pick) - 1];
  if (!item) return end(t.invalid);
  // D164: she answers the screen she read. If the list moved or the rules
  // changed since that screen, her key press must not land on something else.
  const screenKey = `answer:${pick}`;
  const shownItem =
    item.kind === "SWAP" ? `SWAP:${item.swapId}` : `${item.kind}:${item.groupId}:${item.version}`;
  const stillTheSame = () => sawExactly(sessionId, user.phone, screenKey, shownItem);

  if (item.kind === "SWAP") {
    if (action === undefined) {
      remember(sessionId, user.phone, screenKey, shownItem);
      return con(t.swapDetail(item.from, item.group, item.mine, item.theirs));
    }
    if (action === "0") return end(t.bye);
    if (action !== "1" && action !== "2") return end(t.invalid);
    if (!stillTheSame()) return end(t.notNow);
    try {
      await answerSwap(item.groupId, user.id, item.swapId, action === "1");
      return end(action === "1" ? t.swapYes : t.swapNo);
    } catch (err) {
      return refusal(t, err);
    }
  }

  if (action === undefined) {
    remember(sessionId, user.phone, screenKey, shownItem);
    const amount = fcfa(item.amountFcfa);
    const every = t.every[item.frequency];
    return con(
      item.kind === "INVITE"
        ? t.inviteDetail(item.organiser, item.group, amount, every, item.size, item.mfi)
        : t.rulesDetail(item.group, amount, every, item.size, item.mfi),
    );
  }
  if (action === "0") return end(t.bye);
  if (action !== "1" && action !== "2") return end(t.invalid);
  if (!stillTheSame()) return end(t.notNow);
  try {
    if (action === "2") {
      await declineGroup(item.groupId, user.id);
      return end(t.declined);
    }
    // D98: sharing her record while the MFI checks the group is her choice.
    if (extra === undefined) return con(t.shareAsk(item.mfi));
    if (extra !== "1" && extra !== "2") return end(t.invalid);
    await acceptRules(item.groupId, user.id, item.version, extra === "1");
    return end(t.accepted);
  } catch (err) {
    return refusal(t, err);
  }
}

// ---------- Menu 5: her data (D106) ----------

async function dataMenu(user: User, t: Text, rest: string[]): Promise<UssdReply> {
  const [sub, pick, confirm] = rest;
  if (sub === undefined) return con(t.myData(user.legalName, user.displayName));
  if (sub === "0") return end(t.bye);
  if (sub === "1") {
    const lenders = await listLenders();
    if (pick === undefined) return con(`${t.shareWith}\n${lenders.map((l, n) => `${n + 1}. ${l.name}`).join("\n")}`);
    const lender = lenders[Number(pick) - 1];
    if (!lender) return end(t.invalid);
    // D165: one more screen, so sharing is never a single slip of the finger.
    if (confirm === undefined) return con(t.shareConfirm(lender.name));
    if (confirm !== "1") return end(t.bye);
    const share = await shareRecord(user.id, lender.code);
    const until = short(share.expiresAt.slice(0, 10));
    await sms.send(user.phone, t.sharedSms(lender.name, until));
    return end(t.shared(lender.name, until));
  }
  if (sub === "2") {
    const views = await prisma.recordView.findMany({
      where: { share: { userId: user.id }, staffId: { not: null } },
      include: { share: { include: { mfi: { select: { name: true } } } } },
      orderBy: { viewedAt: "desc" },
      take: 5,
    });
    if (views.length === 0) return end(t.noViews);
    return end(
      `${t.views}\n${views
        .map((v) => `${v.share.mfi?.name ?? "?"} ${short(v.viewedAt.toISOString().slice(0, 10))}`)
        .join("\n")}`,
    );
  }
  if (sub === "3") {
    // D165: withdrawing is as easy as sharing, from the same phone.
    const now = new Date();
    const running = (await listShares(user.id)).filter(
      (s) => s.sharedWith && !s.revokedAt && new Date(s.expiresAt) > now,
    );
    if (running.length === 0) return end(t.noShares);
    if (pick === undefined) {
      return con(`${t.revokeWhich}\n${running.map((s, n) => `${n + 1}. ${s.sharedWith?.name} (${short(s.expiresAt.slice(0, 10))})`).join("\n")}`);
    }
    const share = running[Number(pick) - 1];
    if (!share) return end(t.invalid);
    await revokeShare(user.id, share.id);
    return end(t.revoked(share.sharedWith?.name ?? ""));
  }
  return end(t.invalid);
}

// ---------- Sign-up by USSD (D106) ----------

const S = {
  fr: {
    welcome:
      "Novi, la tontine gardée par une institution agréée.\nCe numéro n'a pas de compte.\n1. Créer mon compte\n2. English\n0. Quitter",
    consent:
      "Pour ouvrir votre compte, Novi vérifie votre NIU auprès de l'ANID, et vos paiements forment votre relevé. Vous acceptez les conditions ?\n1. Oui\n0. Non",
    noConsent: "Sans votre accord, Novi ne peut pas ouvrir de compte. À bientôt.",
    niu: "Votre NIU (les 11 chiffres de votre carte, sans tirets) :",
    badNiu: "Le NIU a 11 chiffres. Recomposez le code pour réessayer.",
    dob: "Votre date de naissance (JJMMAAAA, par ex. 12031984) :",
    badDob: "Date non reconnue. Recomposez le code et tapez-la ainsi : 12031984.",
    sent: (masked: string, code?: string) =>
      `L'ANID envoie un code par SMS au ${masked}. Lisez-le, puis recomposez ce code Novi pour le taper (15 min).${code ? ` Pilote : ${code}` : ""}`,
    noMatch: "Ces informations ne correspondent pas au registre de l'ANID. Vérifiez votre carte et réessayez.",
    blocked: "Trop d'essais pour ce NIU. Réessayez dans 24 h ou passez en agence avec votre carte.",
    enterCode: "Tapez le code reçu de l'ANID par SMS :\n0. Recommencer",
    restart: "C'est annulé. Recomposez le code pour recommencer.",
    badCode: "Code incorrect. Recomposez le code Novi pour réessayer.",
    expired: "Le code a expiré. Recomposez le code pour recommencer.",
    already: "Cette identité a déjà un compte Novi. Passez en agence si vous avez changé de numéro.",
    isThisYou: (name: string) => `Identité vérifiée :\n${name}\nEst-ce bien vous ?\n1. Oui\n2. Non`,
    notMe: "Merci. Rien n'est enregistré. Passez en agence avec votre carte d'identité.",
    name: "Le prénom que votre groupe verra (par ex. Akossiwa) :",
    badName: "Tapez un prénom de 2 à 30 lettres. Recomposez le code pour continuer.",
    pin: "Choisissez un code PIN de 4 chiffres. Ne le donnez à personne, même à Novi :",
    weakPin: "Ce PIN est trop facile (1234, 0000…). Recomposez le code et choisissez-en un autre.",
    repeat: "Retapez votre code PIN :",
    differ: "Les deux PIN sont différents. Recomposez le code pour continuer.",
    done: "Votre compte Novi est ouvert. Recomposez ce code et tapez votre PIN pour répondre aux invitations (menu 4) et payer.",
  },
  en: {
    welcome: "",
    consent:
      "To open your account, Novi checks your NIU with ANID, and your payments make your record. Do you accept the terms?\n1. Yes\n0. No",
    noConsent: "Without your consent Novi cannot open an account. Goodbye.",
    niu: "Your NIU (the 11 digits on your card, no dashes):",
    badNiu: "The NIU has 11 digits. Dial the code again to retry.",
    dob: "Your date of birth (DDMMYYYY, e.g. 12031984):",
    badDob: "Date not recognised. Dial the code again and type it like 12031984.",
    sent: (masked: string, code?: string) =>
      `ANID is sending a code by SMS to ${masked}. Read it, then dial this Novi code again to type it (15 min).${code ? ` Pilot: ${code}` : ""}`,
    noMatch: "These details do not match ANID's register. Check your card and try again.",
    blocked: "Too many tries for this NIU. Try again in 24 h or visit an agency with your card.",
    enterCode: "Type the code ANID sent you by SMS:\n0. Start again",
    restart: "Cancelled. Dial the code again to start over.",
    badCode: "Wrong code. Dial the Novi code again to retry.",
    expired: "The code has expired. Dial the code again to start over.",
    already: "This identity already has a Novi account. Visit an agency if you changed number.",
    isThisYou: (name: string) => `Identity checked:\n${name}\nIs this you?\n1. Yes\n2. No`,
    notMe: "Thank you. Nothing was saved. Visit an agency with your ID card.",
    name: "The first name your group will see (e.g. Akossiwa):",
    badName: "Type a first name of 2 to 30 letters. Dial the code again to continue.",
    pin: "Choose a 4-digit PIN. Never give it to anyone, not even Novi:",
    weakPin: "This PIN is too easy (1234, 0000...). Dial the code again and choose another.",
    repeat: "Type your PIN again:",
    differ: "The two PINs differ. Dial the code again to continue.",
    done: "Your Novi account is open. Dial this code again and type your PIN to answer invitations (menu 4) and pay.",
  },
};
type SignUpText = (typeof S)["fr"];

const NAME = /^[\p{L}][\p{L} '-]{1,29}$/u;

async function signUp(phone: string, steps: string[], sessionId: string): Promise<UssdReply> {
  // Novi is for Togolese numbers (and Rwandan ones on the pilot, D111).
  if (!acceptedPhone(phone)) return end(T.fr.foreign);
  const pending = await prisma.ussdSignup.findUnique({ where: { phone } });
  if (pending && pending.expiresAt <= new Date()) {
    await prisma.ussdSignup.delete({ where: { phone } });
    return signUp(phone, steps, sessionId);
  }

  if (pending) {
    const s: SignUpText = pending.language === "EN" ? S.en : S.fr;
    if (pending.legalName) {
      // In the session where she typed the code, that code is still the first step.
      const after = pending.verifiedSession === sessionId ? steps.slice(1) : steps;
      return finishSignUp(phone, pending.legalName, after, s);
    }
    const [code, ...after] = steps;
    if (code === undefined) return con(s.enterCode);
    if (code === "0") {
      await prisma.ussdSignup.delete({ where: { phone } });
      return end(s.restart);
    }
    try {
      const legalName = await confirmUssdIdentity(phone, code, sessionId);
      return finishSignUp(phone, legalName, after, s);
    } catch (err) {
      const reason = err instanceof AppError ? err.code : "";
      if (reason === "ID_CODE_INVALID") return end(s.badCode);
      if (reason === "NIU_ALREADY_REGISTERED") return end(s.already);
      if (reason === "ID_BLOCKED") return end(s.blocked);
      return end(s.expired);
    }
  }

  const [lang, consent, niuTyped, dobTyped] = steps;
  if (lang === undefined) return con(S.fr.welcome);
  if (lang === "0") return end(T.fr.bye);
  if (lang !== "1" && lang !== "2") return end(T.fr.invalid);
  const s: SignUpText = lang === "2" ? S.en : S.fr;
  if (consent === undefined) return con(s.consent);
  if (consent !== "1") return end(s.noConsent);
  if (niuTyped === undefined) return con(s.niu);
  const niu = niuFromKeypad(niuTyped);
  if (!niu) return end(s.badNiu);
  if (dobTyped === undefined) return con(s.dob);
  const dateOfBirth = dateFromKeypad(dobTyped);
  if (!dateOfBirth) return end(s.badDob);
  try {
    const started = await startUssdIdentity({ phone, niu, dateOfBirth, language: lang === "2" ? "EN" : "FR" });
    return end(s.sent(started.maskedPhone, started.pilotCode));
  } catch (err) {
    return end(err instanceof AppError && err.code === "ID_BLOCKED" ? s.blocked : s.noMatch);
  }
}

async function finishSignUp(phone: string, legalName: string, steps: string[], s: SignUpText): Promise<UssdReply> {
  const [yes, name, pin, again] = steps;
  if (yes === undefined) return con(s.isThisYou(legalName));
  if (yes === "2") {
    await prisma.ussdSignup.delete({ where: { phone } });
    await prisma.auditEvent.create({ data: { type: "USSD_SIGNUP_NOT_ME", details: {} } });
    return end(s.notMe);
  }
  if (yes !== "1") return end(T.fr.invalid);
  if (name === undefined) return con(s.name);
  const displayName = name.trim().replace(/\s+/g, " ");
  if (!NAME.test(displayName)) return end(s.badName);
  if (pin === undefined) return con(s.pin);
  if (!/^\d{4}$/.test(pin) || isWeakPin(pin)) return end(s.weakPin);
  if (again === undefined) return con(s.repeat);
  if (again !== pin) return end(s.differ);
  try {
    await registerByUssd({ phone, pin, displayName });
    return end(s.done);
  } catch (err) {
    return end(err instanceof AppError && err.code === "NIU_ALREADY_REGISTERED" ? s.already : s.expired);
  }
}
