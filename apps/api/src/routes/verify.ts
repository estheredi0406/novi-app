import type { RecordVerification } from "@novi/shared";
import { Router } from "express";
import { z } from "zod";
import { publicKeyPem, verifyShare } from "../services/recordService.js";

// Public: what a lender reaches by scanning the QR code on a shared savings
// record (D50). No login: the code itself, 122 random bits, is the key, and
// every opening is logged.
export const verifyApiRouter = Router();
export const verifyPageRouter = Router();

const params = z.object({ id: z.string().uuid() });

// The public key, so a lender's own systems can check signatures.
verifyApiRouter.get("/public-key", (_req, res) => {
  res.json({ algorithm: "Ed25519", publicKeyPem: publicKeyPem() });
});

verifyApiRouter.get("/:id", async (req, res) => {
  const { id } = params.parse(req.params);
  res.json(await verifyShare(id));
});

// The same check as a web page a loan officer can open on any phone.
verifyPageRouter.get("/:id", async (req, res) => {
  const { id } = params.parse(req.params);
  res.type("html").send(renderPage(await verifyShare(id)));
});

// Every value placed in the page is escaped, so a name can never inject code.
const escape = (value: string | number) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const fcfa = (amount: number) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const STATUS_TEXT: Record<RecordVerification["status"], string> = {
  VALID: "Relevé authentique et valide / Genuine and valid record",
  EXPIRED: "Ce partage a expiré / This share has expired",
  REVOKED: "Ce partage a été retiré par son titulaire / Withdrawn by its holder",
  TAMPERED: "Signature invalide : ne pas utiliser / Invalid signature: do not rely on it",
  PRIVATE: "Partagé avec une seule institution / Shared with one institution only",
};

function renderPage(check: RecordVerification): string {
  const r = check.record;
  const rows: [string, string][] = r
    ? [
        ["Titulaire / Holder", r.legalName],
        ["Membre depuis / Member since", day(r.memberSince)],
        ["Groupes / Groups (terminés / completed)", `${r.groupsJoined} (${r.groupsCompleted})`],
        ["Paiements / Payments", `${r.paymentsMade}`],
        ["À l'heure / On time", `${r.paidOnTime}`],
        ["En retard / Late", `${r.paidLate}`],
        ["Manqués / Missed", `${r.missed}`],
        ["Épargné / Saved", fcfa(r.totalSavedFcfa)],
        ["Cagnottes reçues / Pots received", `${r.potsReceived} (${fcfa(r.totalReceivedFcfa)})`],
      ]
    : [];
  const groups = r
    ? r.groups
        .map(
          (g) =>
            `<li>${escape(g.name)}, ${escape(g.mfiName)}: ${escape(fcfa(g.amountFcfa))}, ${g.paid}/${g.roundsDue} (${g.onTime} à l'heure / on time)${g.completed ? ", cycle terminé / completed" : ""}</li>`,
        )
        .join("")
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Novi : relevé d'épargne</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#F8F8FC;color:#141833;max-width:640px}
h1{color:#22306B;font-size:24px}.status{padding:12px 16px;border-radius:12px;font-weight:600;background:${check.status === "VALID" ? "#E3F2EA;color:#1E7A4C" : "#DDE2F5;color:#22306B"}}
table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:8px 0;border-bottom:1px solid #DADFEF}td:last-child{text-align:right;font-weight:600}
small{color:#4B5070}</style></head><body>
<h1>Novi : relevé d'épargne / savings record</h1>
<p class="status">${escape(STATUS_TEXT[check.status])}</p>
${check.status === "PRIVATE" && check.sharedWith ? `<p>${escape(check.sharedWith)} : consultable par son personnel dans la console Novi / its staff can open it in the Novi console.</p>` : ""}
${rows.length ? `<table>${rows.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join("")}</table>` : ""}
${groups ? `<h2>Groupes / Groups</h2><ul>${groups}</ul>` : ""}
<p><small>Émis le / issued ${escape(day(check.issuedAt))} · valable jusqu'au / valid until ${escape(day(check.expiresAt))} · signé par Novi (Ed25519). Faits seulement, aucun score. Facts only, no score.</small></p>
</body></html>`;
}
