# Decision log

Each entry records a choice, why it was made, and what was considered instead. Entries are never rewritten or deleted; a changed decision gets a new entry that names the one it supersedes.

## D1. One repository for the whole system (13 Oct 2026)
The API, mobile app, mock MFI and shared code live in one npm workspaces repository. The app and API import the same type definitions from packages/shared, so if the shape of a contribution changes on one side, the other fails to compile before the demo, not during it. A feature touching both sides is one commit. Considered: separate repositories; rejected because shared types would have to be published and versioned separately.

## D2. Novi never holds money (13 Oct 2026)
Contributions go to an account at a licensed microfinance institution. Novi keeps the rules and the ledger and instructs the MFI to pay out. Under BCEAO Instruction n°001-01-2024, only banks, microfinance institutions, payment institutions and e-money issuers may provide payment services; Novi holds none of these licences.

## D3. Every outside service sits behind an interface (13 Oct 2026)
Identity checks, payments, the MFI and SMS are reached through IdentityProvider, PaymentProvider, MfiAdapter and SmsProvider. The demo uses mock versions; a real provider replaces one file. Reasons: FedaPay documents sandbox test numbers for Benin only, ANID identity checks are open to partners only, and Africa's Talking does not offer SMS or USSD in Togo in production.

## D4. Money is stored as whole numbers of FCFA (13 Oct 2026)
FCFA is used without a smaller unit in daily trade, and decimal numbers in JavaScript cause rounding errors (0.1 + 0.2 gives 0.30000000000000004). Every amount is an integer number of FCFA.

## D5. The ledger is append-only (13 Oct 2026)
A ledger entry is never edited or deleted; a correction is a new entry that references the one it corrects. Every member can then trust that the history she sees is the history that happened, which answers the trust problem behind organiser fraud in tontines.

## D6. Node.js 24 (13 Oct 2026)
Supersedes the Node 20 choice in the original build brief. Node 20 reached end of life on 30 April 2026 and no longer receives security fixes (nodejs.org/en/about/previous-releases); Node 24 is the current long-term support line. Pinned in .nvmrc and in the engines field of package.json so development and hosting run the same version.