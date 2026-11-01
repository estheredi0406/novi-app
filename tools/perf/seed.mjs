// Creates 12 members and one running group of 12 through the real HTTP API.
import { randomUUID } from "node:crypto";
const B = process.env.API ?? "http://localhost:3100";
const post = async (p, body, token) => {
  const r = await fetch(B + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const people = [
  ["0000-000-0001", "Akossiwa Afi Mensah", "1984-03-12"], ["0000-000-0002", "Abla Dzifa Agbeko", "1990-07-25"],
  ["0000-000-0004", "Adjoa Mawuena Kpodar", "1988-05-04"], ["0000-000-0005", "Ama Essi Lawson", "1992-11-19"],
  ["0000-000-0006", "Afi Yawa Dogbe", "1986-02-27"], ["0000-000-0007", "Kafui Edem Ahianyo", "1995-09-08"],
  ["0000-000-0008", "Senam Aku Koudjo", "1991-06-30"], ["0000-000-0009", "Enyonam Afiwa Attisso", "1983-12-15"],
  ["0000-000-0010", "Delali Sitsofe Gbadoe", "1997-04-21"], ["0000-000-0011", "Essowazina Afi Palanga", "1989-08-03"],
  ["0000-000-0012", "Magnoudewa Abra Tchalla", "1985-01-01"], ["0000-000-0013", "Ayoko Prisca Akakpo", "1993-03-17"],
];
const tokens = [];
for (const [i, [niu, name, dob]] of people.entries()) {
  const phone = `+2289100${String(i + 1).padStart(4, "0")}`;
  const otp = await post("/v1/auth/otp", { phone, purpose: "SIGN_UP", language: "FR" });
  const { verificationToken } = await post("/v1/auth/otp/verify", { challengeId: otp.challengeId, code: otp.pilotCode });
  const start = await post("/v1/auth/identity/start", { verificationToken, consentToIdCheck: true, niu, legalName: name, dateOfBirth: dob });
  const { identityToken } = await post("/v1/auth/identity/confirm", { verificationToken, pendingToken: start.pendingToken, code: start.pilotCode });
  const reg = await post("/v1/auth/register", { verificationToken, identityToken, pin: "4829", displayName: name.split(" ")[0], area: "Bè", market: "Assigamé", language: "FR", installationId: randomUUID(), acceptedTerms: true, acceptedCreditDataUse: true });
  tokens.push({ phone, token: reg.tokens.accessToken });
}
const org = tokens[0].token;
const g = await post("/v1/groups", { name: "Pagnes Assigamé", amountFcfa: 5000, frequency: "WEEKLY", dueDay: 5, size: 12, payoutOrder: "DRAWN" }, org);
for (const m of tokens.slice(1)) await post(`/v1/groups/${g.id}/invites`, { phone: m.phone }, org);
await post(`/v1/groups/${g.id}/propose`, { shareConsent: true }, org);
for (const m of tokens.slice(1)) await post(`/v1/groups/${g.id}/accept`, { version: 1, shareConsent: true }, m.token);
const started = await post(`/v1/groups/${g.id}/start`, {}, org);
for (const m of tokens.slice(0, 7)) await post(`/v1/groups/${g.id}/messages`, { body: "Bonjour à toutes, je paie vendredi." }, m.token);
console.log(JSON.stringify({ state: started.state, groupId: g.id, token: tokens[1].token }));
