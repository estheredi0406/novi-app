# Testing and results

How Novi was tested, what came out, and what was changed because of it. Every figure here can be reproduced with the commands given; the scripts are in `tools/perf/`.

## Summary

| Strategy | What it checks | Result |
| --- | --- | --- |
| Unit and integration tests (API) | Pure rules (rules engine, calendar, streak, PIN rules, hashing, TOTP, signing) and every endpoint through real HTTP against a real PostgreSQL test database | 36 files, **372 tests, all passing** (397 s) |
| Unit tests (app) | Formatting, the Payer button's choice, rules text in French, ID barcode reading | 4 files, **16 tests, all passing** |
| Performance (load) | API under 50 and 100 simultaneous users | 0 errors in about 110 000 requests; slowest screen p99 under 0.8 s at 100 users |
| Compatibility (console) | Console at five screen sizes in Chromium | 30 page loads, 0 script errors; 2 layout bugs found and fixed |
| Resource use (app) | Size of what the phone downloads | 22 MB reduced to 5.8 MB |
| Device testing (app) | Real phones: one iPhone, one low-cost Android | To fill in (see the last section) |

## 1. Unit and integration tests

**Why.** Novi moves other people's money. The rules that matter most (who receives the pot, when, and how much; that a payment is credited once only) must hold whatever the phone, the network or the payment provider does. Integration tests drive the real endpoints, so they test the route, the validation, the business rule and the database together.

**How.** Vitest and Supertest. The integration tests use a separate `novi_test` database, emptied before each test; a guard in `src/test/setup.ts` refuses to run against any other database. Providers (SMS, identity, payment, MFI) are replaced by their mock classes, so a test can play the provider's part: send a webhook twice, send one with a wrong signature, refuse a transfer.

```bash
npm test                                   # everything
cd apps/api && npx vitest run src/test/money.test.ts
cd apps/mobile && npm test
```

**Testing with different inputs.** Each area tests the expected case, the wrong inputs and the edge cases. Examples, with the exact test names:

| Input | Expected behaviour | Test |
| --- | --- | --- |
| Group of 2 members | Refused with the rules engine's own error code | `groups.test.ts` "refuses a group of 2 with the rules engine's own error code" |
| Amount 4 999.5 FCFA | Refused: money is whole FCFA (D4) | "refuses an amount that is not whole FCFA" |
| A 4th live group | Refused (D26) | "refuses a 4th live group for the same organiser" |
| Same payment webhook sent 3 times | Credited once (D45) | `money.test.ts` "credits a payment once, however many times the webhook arrives or she checks" |
| Webhook with a wrong signature | Refused, nothing credited | "refuses a webhook with a wrong signature and credits nothing" |
| Webhook amount differs from the contribution | Not credited | "does not credit a payment whose amount differs from the contribution" |
| Webhook lost | Found when she checks | "finds a payment whose webhook was lost when she checks" |
| Two payout runs at the same moment | Pot sent once (D49) | `payouts.test.ts` "sends a pot once only, even when two runs happen at the same moment" |
| Pot short because someone did not pay | Held, never sent short (D48) | "holds the pot instead of sending it short, and everyone sees it held" |
| Anything trying to edit a ledger line | Refused by the database trigger | "is refused by the database itself if anything tries to change or delete a line" |
| Wrong PIN on USSD | Session ended, counts towards lockout | `ussd.test.ts` "ends the session on a wrong PIN, and counts it towards the lockout" |
| Easy PIN such as 1234 | Refused | `auth.pin.test.ts` "refuses an easy new PIN" |
| Someone outside the group asks for it | `NOT_FOUND`, as if it did not exist | "answers NOT_FOUND to someone with no seat in the group" |

**Results.** API: 36 files, 372 tests, all passing on 1 November 2026. App: 4 files, 16 tests, all passing.

**Improvements made from testing.** The tests are written to fail if a pot could ever be sent twice (D49) or a payment credited twice (D45), so any change that breaks those rules is stopped before it is deployed. Testing the screens with real data showed the payment screen giving one contribution (4 900 FCFA) where the full pot (58 800 FCFA) was meant; fixed by adding `RoundSummary.amountFcfa`. One test (`alerts.test.ts`, escalation) failed once in a full run and passed three times alone; it depends on timing and is noted as a known flaky test.

## 2. Performance under load

**Why.** In a tontine everyone pays around the same moment (Friday morning before the market, or the evening of a market day), and everyone opens home to see the ring fill. The question is whether the API stays fast when 50 or 100 members open the app at once.

**How.** `autocannon`, 15 seconds per run, against the API built for production (`NODE_ENV=production`) with a real PostgreSQL 16 database on the same machine. Data was created through the real API by `tools/perf/seed.mjs`: 12 members, one running group of 12 paying 5 000 FCFA, 7 messages. Machine: cloud container, 2 vCPU (Intel Xeon 2.1 GHz), 7 GB RAM, Node 22. This is close to an ordinary laptop. Small hosting plans have less CPU than this, so on the pilot server these figures are an upper bound, not a promise.

```bash
cd apps/api && PILOT_SHOW_CODES=true PORT=3100 npm start      # with a test database
cd tools/perf && node seed.mjs > seed.json && node load.mjs
```

**Results** (milliseconds; 0 errors and 0 non-2xx responses in every run):

| Endpoint (screen) | Users | Requests/s | p50 | p97.5 | p99 | Max |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /health` (API and database alive) | 50 | 2 635 | 17 | 38 | 44 | 117 |
| | 100 | 2 854 | 33 | 50 | 60 | 326 |
| `GET /v1/groups` (home: groups, ring, receiver) | 50 | 215 | 228 | 340 | 393 | 426 |
| | 100 | 200 | 499 | 595 | 785 | 887 |
| `GET /v1/me/news` (home: latest news) | 50 | 455 | 105 | 164 | 179 | 302 |
| | 100 | 440 | 219 | 289 | 419 | 554 |
| `GET /v1/groups/:id/rounds/1` (round, 12 payments) | 50 | 307 | 161 | 212 | 224 | 294 |
| | 100 | 305 | 323 | 414 | 427 | 561 |

One request at a time (median of 40): `/health` 2.2 ms, `/v1/me` 2.8 ms, `/v1/me/news` 5.8 ms, `/v1/groups/:id/rounds/1` 5.6 ms, `/v1/groups` 9.1 ms.

**Analysis.** Throughput stays flat from 50 to 100 users and only the waiting time grows, which means the server's two CPUs are the limit, not the database or a lock. No request failed. The slowest screen is home (`/v1/groups`), because for each group it computes the current round, who has paid and the unread count.

**Improvement tried.** In `listMyGroups` (`services/group/reading.ts`) the current round and the unread count were computed one after the other; they now run in parallel (`Promise.all`). A second run gave 188 requests/s at 50 users and 195 at 100: no measurable gain under load, which confirms the limit is CPU, not waiting on the database. The change was kept because it lowers the time of a single request on a real network, where each database call waits longer. The next step, if the pilot grows, is to cache each group's round summary for a few seconds or add a second instance.

## 3. Console compatibility (browsers and screen sizes)

**Why.** The MFI officer uses the console on whatever the agency has: a desktop, an older laptop, sometimes a tablet or her phone at the agency door.

**How.** Playwright with Chromium 141, against the real API and the seeded data: six pages (Today, a group, Credits, Journal, Analytics, Members) at five sizes, each page loaded from scratch. For each, the script records the load time, page errors, horizontal scrolling, and any element sticking out of the screen. Script: `tools/perf/browsers.cjs`.

**Results.**

| Size | Pages | Load (first page / others) | Script errors | Horizontal scroll |
| --- | --- | --- | --- | --- |
| Desktop 1440 × 900 | 6 | 0.76 s / 0.59 to 0.70 s | 0 | none |
| Laptop 1280 × 720 | 6 | 0.71 s / 0.58 to 0.65 s | 0 | none |
| Small laptop 1024 × 768 | 6 | 0.70 s / 0.59 to 0.64 s | 0 | none (after fix) |
| Tablet 768 × 1024 | 6 | 0.69 s / 0.58 to 0.62 s | 0 | none (after fix) |
| Phone (Pixel 5 emulation) | 6 | 0.70 s / 0.58 to 0.77 s | 0 | none |

**Bugs found and fixed.**
1. Below 900 px the dark menu filled the whole first screen, so the officer saw no content without scrolling. Cause: a `min-height: 100vh` added for desktops also applied to narrow screens. Fixed by limiting it to screens wider than 900 px.
2. On the group page at 1024 and 768 px the page scrolled sideways: the four money figures could not shrink, and a grid column will not shrink below its widest child by default. Fixed with `min-width: 0` on the main column, the figures two by two below 1 200 px, and the round card above them.

Firefox and Safari: to check by hand (see below). Screenshots of the app, console, USSD and a test run are in [docs/screenshots](screenshots/).

## 4. App size (resource use)

**Why.** Many traders in Lomé use low-cost Android phones with little storage and pay for data by the megabyte. Every update the app downloads costs them.

**How.** `npx expo export --platform android`, which produces what an update downloads: the JavaScript (Hermes bytecode) and the assets.

**Result and improvement.** The first measure was **22 MB**, of which 18 MB were 36 font files: importing `@expo-google-fonts/noto-sans` from its root pulls in every weight, although the app uses four. Importing each weight from its own file (`apps/mobile/src/app/_layout.tsx`) brought the export to **5.8 MB** (3.6 MB of code, 2.3 MB of assets), 74 % less.

## 5. Device tests (to fill in by Esther)

| Phone | OS | RAM | Start to home (s) | Pay a contribution | Call / meeting | Problems seen |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone … | iOS … | | | | | |
| Android … (low cost) | Android … | | | | | |

Console in other browsers:

| Browser | Version | Login | Today | Group page | Problems |
| --- | --- | --- | --- | --- | --- |
| Firefox | | | | | |
| Safari | | | | | |
| Edge | | | | | |
