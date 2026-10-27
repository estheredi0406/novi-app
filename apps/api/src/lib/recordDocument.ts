import type { RecordVerification } from "@novi/shared";

// The ACEV as a document (D65): an attestation a loan officer can read,
// print or save as PDF (the browser's "Print", then "Save as PDF"), laid out
// on one A4 page. The same document is shown to a lender who scans the QR
// code and to an MFI officer in the console. Facts only, no score.

const escape = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const fcfa = (amount: number) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const STATUS: Record<RecordVerification["status"], { fr: string; en: string; tone: "ok" | "warn" | "bad" }> = {
  VALID: { fr: "Attestation authentique et valide", en: "Genuine and valid", tone: "ok" },
  EXPIRED: { fr: "Attestation expirée", en: "This attestation has expired", tone: "warn" },
  REVOKED: { fr: "Retirée par sa titulaire", en: "Withdrawn by its holder", tone: "warn" },
  TAMPERED: { fr: "Signature invalide : ne pas utiliser", en: "Invalid signature: do not rely on it", tone: "bad" },
  PRIVATE: { fr: "Partagée avec une seule institution", en: "Shared with one institution only", tone: "warn" },
};

export type DocumentMeta = {
  shareId: string;
  verifyUrl: string; // where the QR code leads
  qrSvg: string; // the QR code, drawn by the server
  publicKeyUrl: string;
};

export function renderRecordDocument(check: RecordVerification, meta: DocumentMeta): string {
  const r = check.record;
  const status = STATUS[check.status];
  const number = `ACEV-${meta.shareId.slice(0, 8).toUpperCase()}`;
  const mfis = r ? [...new Set(r.groups.map((g) => g.mfiName))].join(", ") : (check.sharedWith ?? "");
  const onTime = r && r.paymentsMade > 0 ? (r.onTimeRate ?? Math.round((r.paidOnTime / r.paymentsMade) * 100)) : 0;

  const figures: [string, string, string][] = r
    ? [
        [`${onTime} %`, "paiements à l'heure", `${r.paidOnTime} sur ${r.paymentsMade} · on time`],
        [fcfa(r.totalSavedFcfa), "épargnés", "saved through Novi"],
        [
          `${r.potsReceived}`,
          "cagnottes reçues",
          `${fcfa(r.totalReceivedFcfa)}${r.potsConfirmed !== undefined ? ` · ${r.potsConfirmed} confirmée(s)` : ""}`,
        ],
        [`${r.groupsCompleted}/${r.groupsJoined}`, "cycles terminés", "completed cycles"],
      ]
    : [];

  const facts: [string, string][] = r
    ? [
        ["Membre depuis / Member since", day(r.memberSince)],
        ["Paiements effectués / Payments made", `${r.paymentsMade}`],
        ["Dont à l'heure / On time", `${r.paidOnTime}`],
        ["En retard / Late", `${r.paidLate}`],
        ["Manqués / Missed", `${r.missed}`],
        ["Lignes du registre / Ledger lines", r.ledgerLines !== undefined ? `${r.ledgerLines}` : "n/a"],
      ]
    : [];

  const groupRows = r
    ? r.groups
        .map(
          (
            g,
          ) => `<tr><td>${escape(g.name)}</td><td>${escape(g.mfiName)}</td><td class="num">${escape(fcfa(g.amountFcfa))}</td>
<td>${g.frequency === "WEEKLY" ? "hebdo." : "mensuel"}</td><td class="num">${g.paid}/${g.roundsDue}</td><td class="num">${g.onTime}</td>
<td>${g.completed ? "Terminé" : "En cours"}</td></tr>`,
        )
        .join("")
    : "";

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(number)} · Novi</title>
<style>
:root{--navy:#1B1F4B;--orange:#F05A1A;--lav:#DCD8EE;--cream:#FBF7F2;--ink:#141833;--muted:#3A3D6B;--line:#E6E1F2;--paid:#1E7A4C;--problem:#C2362B}
*{box-sizing:border-box}
body{margin:0;background:#ECEAF3;font-family:"Noto Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink)}
.sheet{max-width:794px;margin:24px auto;background:#fff;border:1.5px solid var(--navy);box-shadow:6px 6px 0 var(--navy)}
header{background:var(--navy);color:#fff;padding:22px 28px;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;position:relative;overflow:hidden}
header .brand{font-size:30px;font-weight:800;letter-spacing:.5px}
header .title{font-size:15px;font-weight:700;margin-top:6px;line-height:1.35}
header .title small{display:block;font-weight:400;opacity:.8}
header .no{text-align:right;font-size:13px;line-height:1.6}
header .no b{font-size:15px}
.band{height:10px;background:repeating-linear-gradient(90deg,var(--orange) 0 18px,var(--lav) 18px 30px,#1FA3A0 30px 40px,var(--lav) 40px 52px)}
main{padding:24px 28px 28px}
.status{display:flex;gap:10px;align-items:center;padding:12px 16px;border-radius:12px;font-weight:700;border:1.5px solid}
.status.ok{background:#E3F2EA;color:var(--paid);border-color:var(--paid)}
.status.warn{background:var(--lav);color:var(--navy);border-color:var(--navy)}
.status.bad{background:#F6D6D2;color:var(--problem);border-color:var(--problem)}
.status small{font-weight:400}
.holder{display:grid;grid-template-columns:1fr auto;gap:16px;margin:22px 0 6px;align-items:end}
.label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);font-weight:700}
.name{font-size:26px;font-weight:800;color:var(--navy);margin-top:2px}
.sub{font-size:13px;color:var(--muted);margin-top:4px}
.figures{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
.fig{border:1.5px solid var(--navy);border-radius:14px;padding:12px;background:var(--cream)}
.fig .v{font-size:22px;font-weight:800;color:var(--navy)}
.fig .k{font-size:12px;font-weight:700;margin-top:2px}
.fig .s{font-size:11px;color:var(--muted);margin-top:2px}
h2{font-size:14px;color:var(--navy);margin:20px 0 8px;text-transform:uppercase;letter-spacing:.6px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;padding:6px 6px;border-bottom:1.5px solid var(--navy)}
td{padding:7px 6px;border-bottom:1px solid var(--line)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.facts td:last-child{text-align:right;font-weight:700}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.verify{display:grid;grid-template-columns:132px 1fr;gap:18px;margin-top:22px;padding:16px;border:1.5px dashed var(--navy);border-radius:14px;align-items:center}
.verify svg{width:132px;height:132px;display:block}
.verify p{margin:4px 0;font-size:12px;line-height:1.5;color:var(--muted)}
.verify code{font-size:11px;word-break:break-all;color:var(--ink)}
.note{font-size:11px;color:var(--muted);margin-top:16px;line-height:1.5}
.actions{max-width:794px;margin:0 auto 32px;display:flex;justify-content:flex-end;gap:10px;padding:0 4px}
button{font:700 15px "Noto Sans",system-ui,sans-serif;background:var(--orange);color:#fff;border:1.5px solid var(--navy);border-radius:14px;padding:12px 20px;box-shadow:3px 3px 0 var(--navy);cursor:pointer}
@media (max-width:640px){.figures{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.holder{grid-template-columns:1fr}header{flex-direction:column}header .no{text-align:left}.sheet{margin:0;border:0;box-shadow:none}}
@media print{body{background:#fff}.sheet{margin:0;max-width:none;border:0;box-shadow:none}.actions{display:none}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4;margin:12mm}}
</style></head><body>
<div class="sheet">
<header>
  <div><div class="brand">Novi</div>
  <div class="title">Attestation de Comportement d'Épargne Vérifiée (ACEV)<small>Verified savings behaviour attestation</small></div></div>
  <div class="no"><b>${escape(number)}</b><br>Émise le ${escape(day(check.issuedAt))}<br>Valable jusqu'au ${escape(day(check.expiresAt))}</div>
</header>
<div class="band"></div>
<main>
<div class="status ${status.tone}">${status.tone === "ok" ? "✓" : "!"} ${escape(status.fr)} <small>· ${escape(status.en)}</small></div>
${
  check.status === "PRIVATE" && check.sharedWith
    ? `<p class="sub">Cette attestation a été partagée avec <b>${escape(check.sharedWith)}</b> uniquement : son personnel la consulte dans la console Novi. This attestation was shared with ${escape(check.sharedWith)} only.</p>`
    : ""
}
${
  r
    ? `<div class="holder"><div><div class="label">Titulaire / Holder</div><div class="name">${escape(r.legalName)}</div>
<div class="sub">Identité vérifiée par ${escape(r.identityCheckedBy ?? "ANID")} le ${escape(day(r.memberSince))} · faits arrêtés au ${escape(day(r.asOf))}</div></div>
<div><div class="label">Fonds détenus par / Funds held by</div><div class="sub" style="font-weight:700;color:var(--navy);font-size:15px">${escape(mfis)}</div></div></div>
<div class="figures">${figures.map(([v, k, s]) => `<div class="fig"><div class="v">${escape(v)}</div><div class="k">${escape(k)}</div><div class="s">${escape(s)}</div></div>`).join("")}</div>
<div class="two"><div><h2>Régularité / Regularity</h2><table class="facts">${facts.map(([k, v]) => `<tr><td>${escape(k)}</td><td>${escape(v)}</td></tr>`).join("")}</table></div>
<div><h2>Méthode / Method</h2><p class="note" style="margin-top:0">Chaque paiement provient d'une transaction mobile money confirmée par l'opérateur, puis inscrite dans un registre que personne ne modifie. Les fonds sont détenus par l'IMF, jamais par Novi ni par une organisatrice. « À l'heure » : payé au plus tard le jour prévu. Aucune note ni score : des faits.</p>
<p class="note">Each payment comes from a mobile money transaction confirmed by the operator and written to a ledger nobody edits. Funds are held by the MFI. Facts only, no score.</p></div></div>
<h2>Groupes / Groups</h2>
<table><tr><th>Groupe</th><th>IMF</th><th class="num">Cotisation</th><th>Rythme</th><th class="num">Payés/dus</th><th class="num">À l'heure</th><th>Cycle</th></tr>${groupRows || '<tr><td colspan="7">Aucun groupe démarré.</td></tr>'}</table>`
    : ""
}
<div class="verify">${meta.qrSvg}<div>
<p><b style="color:var(--navy)">Vérifier cette attestation / Verify</b></p>
<p>Scannez le code ou ouvrez : <code>${escape(meta.verifyUrl)}</code></p>
<p>Signée numériquement par Novi (Ed25519). Clé publique : <code>${escape(meta.publicKeyUrl)}</code></p>
${r?.ledgerFingerprint ? `<p>Empreinte du registre (SHA-256) : <code>${escape(r.ledgerFingerprint)}</code></p>` : ""}
</div></div>
<p class="note">Partagée par sa titulaire, qui peut la retirer à tout moment ; chaque consultation est enregistrée et lui est visible. Shared by its holder, who can withdraw it at any time; every opening is logged and visible to her.</p>
</main></div>
<div class="actions"><button onclick="window.print()">Imprimer / PDF</button></div>
</body></html>`;
}
