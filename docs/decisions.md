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

## D7. Local database for development; Railway for deployment only (13 Oct 2026)
PostgreSQL runs on the developer's laptop during Sprints 0 to 8; Railway hosts the API and database from Sprint 9, with one trial deployment of the API at the end of Sprint 0 to prove the pipeline. Railway's Free plan gives $1 of credit per month and its Hobby plan costs $5 per month (docs.railway.com/pricing), which would not keep an API and a database running continuously while no users exist; trial databases are deleted 30 days after credits expire. A local database also works offline. Moving changes only DATABASE_URL.

## D8. PostgreSQL 18 with a dedicated, limited user (13 Oct 2026)
Development uses PostgreSQL 18 on port 5432. The API connects as novi_app, which owns only the novi_dev database, never as the postgres administrator (least privilege). novi_app has CREATEDB because Prisma creates a temporary shadow database to check each migration.

## D9. Prisma ORM 7.10.0, pinned exactly (13 Oct 2026)
On 13 Oct 2026 the npm registry tagged prisma 8.0.0-rc.22 (a release candidate) as latest, with stable 7.10.0 under the prev tag. Novi uses the stable line. prisma, @prisma/client and @prisma/adapter-pg are installed with exact versions because they must always match. The generated client is written to apps/api/src/generated so it stays inside the TypeScript rootDir, and is ignored by Git because prisma generate rebuilds it.

## D10. Expo SDK 57, blank template, Expo Go until native modules are needed (14 Oct 2026)
The mobile app starts from Expo's blank TypeScript template so every file is written and explained by the author. It runs in Expo Go during development; a development build replaces it when a feature needs native code Expo Go lacks (WatermelonDB, Sprint 6). No web target: Novi's users are on phones, and the MFI console is a separate web project.

## D11. Known npm audit warnings deferred to the security pass (14 Oct 2026)
create-expo-app reported 22 vulnerabilities, mostly in development tooling. npm audit fix --force is not used because it upgrades packages beyond the versions Expo SDK 57 supports. They are reviewed in Sprint 9 with npm audit --omit=dev, which lists only issues in shipped code.

## D12. Identity is verified before an account exists (14 Oct 2026)
Under BCEAO Instruction 003-03-2025, Art. 14(5), a remote client's first transaction may only happen after her identity is verified. At sign-up, after consenting, the member enters her NIU, full name and date of birth; the mock ANID service checks they match its record and sends a one-time code to the phone on ANID's record, as MOSIP-based systems do. Names are compared ignoring capitals and extra spaces; everything else must match exactly. After 3 failed attempts the NIU is blocked for 24 hours and she is told to visit the MFI with her ID card. No account is created until verification succeeds, so there is no unverified account state and no ID queue for MFI officers. Supersedes the build brief's "accept invitations but cannot pay" state. Known limitation: the phone on ANID's record may not be hers today; the branch fallback covers this.

## D13. Women traders first, open to every informal trader (14 Oct 2026)
Novi is designed around informal women traders, the group most affected by the problem: women hold 69.7% of jobs in Togo's informal units (INSEED & AFRISTAT, ERI-ESI 2017) and 45.4% of women own a financial account against 70.0% of men (Global Findex 2024). It starts in Lomé's markets but serves any informal trader: informal work extends well beyond markets (91.6% of jobs in Togo are informal, same survey), and nothing excludes men. A member records the neighbourhood where she trades (required, never an exact location) and a market only if she trades in one. Novi stores no gender: the product does not need it, and the women focus is measured in the research, not in the database. Interface text uses neutral wording, including in gendered languages such as French.