# Novi business rules

Each rule below is enforced in the API, which is the only place that decides. The apps only show what the API answers. Next to each rule: where it lives, and the test that checks it. Decisions (Dxx) are explained in [decisions.md](decisions.md).

## 1. Accounts and identity

| Rule | Where | Test |
|---|---|---|
| A Togolese number (+228, 8 digits); +250 only on the pilot server (D111) | `lib/phone.ts` | `auth.otp` |
| SMS code: 6 digits, 5 minutes, 5 tries, one new code per 60 s | `authService` | `auth.otp` |
| Identity: name, date of birth and NIU checked against the register, then a code to her phone; 3 failed checks block the NIU 24 h | `identityService` | `auth.identity` |
| One account per person: a second NIU is refused after the register confirms her | `identityService` | `auth.identity` |
| PIN: 4 digits, easy PINs refused, stored only as a hash; 5 wrong PINs lock 15 min, longer the next time | `lib/pinRules.ts`, `authService` | `auth.login`, `auth.pin` |
| A new phone needs the PIN and an SMS code | `authService` | `auth.login` |

## 2. Groups

| Rule | Where | Test |
|---|---|---|
| 3 to 15 members; 100 to 1 000 000 FCFA, whole francs (D28, D31) | `lib/groupRules.ts` | `groups`, `groupRules` |
| Daily, weekly or monthly; a monthly due day stops at 28 (D30, D92) | `lib/groupRules.ts` | `news`, `groupRules` |
| At most 3 live groups per member (D26); 2 starts before a completed cycle (D27) | `lib/groupRules.ts` | `answers`, `groups` |
| The group chooses its MFI; changing it asks every member again (D95) | `groupService` | `mfiChoice` |
| A member accepts the exact version she read; a change asks her again (D29) | `lib/groupRules.ts` | `answers` |
| Starts only when every seat is filled and every member accepted the current rules | `lib/groupRules.ts` | `groupRules` |
| The MFI validates the group before its account opens (D66); refused while its savings conditions are incomplete (D147) | `consoleService` | `console` |
| Every member is told when the caisse checks, opens or declines the group, with its reason (D152) | `notifyService` | |
| A member with no Novi history cannot take turn 1 (D104) | `lib/groupRules.ts` | `advance` |
| A member who owes the group's advances cannot join or create a group | `groupService` | `protection` |

## 3. Paying

| Rule | Where | Test |
|---|---|---|
| Round 1 is the contribution plus an advance of half a contribution (D103) | `lib/groupRules.ts` | `money`, `advance` |
| Paid only from her own number, rounds up to the current one, and the next one once the current is paid (D83) | `lib/groupRules.ts` | `money` |
| One payment per round; a request waits 5 minutes before another can be sent | `lib/groupRules.ts` | `money` |
| A payment is credited only when the provider confirms it, for the exact amount, once (D45) | `moneyService` | `money`, `money-check` |
| A notification with a wrong signature credits nothing | `moneyService` | `money` |
| Novi asks again by itself when a confirmation does not arrive (D114) | `exceptionService` | `alerts` |
| The ledger cannot be changed or deleted, even by the database (D5) | migration trigger | `money` |

## 4. Missing shares and the group's advances

| Rule | Where | Test |
|---|---|---|
| "Je ne peux pas payer ce tour": twice a cycle, never two turns in a row, never round 1, never her own turn, never while she owes, before the due date (D104) | `lib/groupRules.ts` | `advance` |
| A covered share is repaid within 7 days, or before the next turn if later; the organiser can extend once; a second miss is default | `lib/groupRules.ts`, `advanceService` | `advance` |
| A debt is taken from her own pot first | `reserveService` | `protection` |
| At the end of the cycle the advances go back in proportion to what each put in; a member who still owes gets nothing back (D103) | `reserveService` | `payouts` |
| A returned advance is followed like a pot: retried, the officers told, an SMS when it arrives (D149) | `reserveService` | `payouts` |

## 5. Pots

| Rule | Where | Test |
|---|---|---|
| Nothing leaves before the due date; a pot that is not full is held, never sent short (D48) | `lib/groupRules.ts` | `payouts` |
| A full pot under the MFI's ceiling leaves alone; above it, two officers release it; with no ceiling chosen, an officer releases every pot (D105, D134) | `payoutService` | `payouts`, `console` |
| A pot is sent once, even if two runs meet (D49) | `payoutService` | `payouts` |
| A pot that would leave alone first waits for her answer (where it goes) until the end of its due day, when her caisse offers savings (D151) | `payoutService` | `savings` |
| A refused transfer is tried again after 5 min, 30 min and 2 h, then the officers are told (D114) | `payoutService` | `payouts` |
| Only the member who received it confirms or disputes it (D63) | `payoutService` | `payouts` |
| The group is completed once every round is paid out | `payoutService` | `payouts` |

## 6. Savings at the MFI

| Rule | Where | Test |
|---|---|---|
| The MFI sets rates, fees, minimum and the early-withdrawal rule before any group; without them, no savings are offered (D147) | `savingsService` | `savings`, `console` |
| She chooses once, right after accepting the rules; with no answer, the whole pot goes to her mobile money (D147) | `savingsService` | `savings` |
| She can change her choice until her pot leaves (D126) | `savingsService` | `savings` |
| Breaking a placement early follows the MFI's rule: gains lost or a penalty (D147) | `savingsService` | `savings` |

## 7. Credit

| Rule | Where | Test |
|---|---|---|
| The MFI's conditions: a finished cycle or 8 payments on time in a row, 90 % on time, nothing owed, no open request, 30 days after a refusal (default values, set by the MFI) (D91) | `loanService` | `help` |
| Savings at the MFI first, if the MFI asks it (D123, D125) | `loanService` | `savings` |
| At most 3 times her largest pot | `loanService` | `help` |
| She declares her business: what she sells, since when, weekly sales, where; declared, not verified | `loanService` | `help` |
| Preselected: she comes to sign at the agency with the documents listed; Novi keeps no document | `loanService` | `help` |
| Granted at the agency, never more than she asked; a refusal at the first look or at the agency starts the wait | `loanService` | `help` |

## 8. Privacy

| Rule | Where | Test |
|---|---|---|
| The MFI sees group totals and seats by turn, never who paid (D33, D117) | `consoleService` | `console` |
| Names only in the compliance view, opened with a reason and logged (D117) | `consoleService` | `console` |
| Her record reaches the MFI only with her consent: when it validates her group, or with a loan request (D37, D84, D98) | `recordService`, `loanService` | `mfiChoice`, `record` |
