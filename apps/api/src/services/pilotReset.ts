import { prisma } from "../lib/db.js";
import { pilotMode } from "../lib/pilot.js";

// Pilot only (D93): deletes every group and what happened in it, but keeps the
// people (accounts, PINs, officer logins, credit conditions).
// The ledger refuses deletes (D5); TRUNCATE is the only way to empty it, used
// here on purpose for test data. Refuses to run outside pilot mode.

// Journal lines about the people themselves, kept: sign-up, identity check,
// logins, PIN events, and the MFI's team.
const KEEP_EVENTS = [
  "USER_REGISTERED",
  "ID_CHECK",
  "TERMS",
  "LOGIN",
  "LOGOUT",
  "DEVICE_TRUSTED",
  "PIN_LOCKED",
  "PIN_RESET",
  "REFRESH_TOKEN_REUSED",
  "STAFF_CREATED",
  "STAFF_LOGIN",
  "STAFF_PASSWORD_CHANGED",
  "STAFF_ADDED",
  "STAFF_DEACTIVATED",
  "STAFF_REACTIVATED",
  "STAFF_ACCESS_RESET",
];

export type PilotCounts = {
  groups: number;
  payments: number;
  pots: number;
  messages: number;
  loans: number;
  journal: number;
  members: number;
};

export async function countPilotData(): Promise<PilotCounts> {
  const [groups, payments, pots, messages, loans, journal, members] = await Promise.all([
    prisma.group.count(),
    prisma.contribution.count(),
    prisma.payout.count(),
    prisma.groupMessage.count(),
    prisma.loanRequest.count(),
    prisma.auditEvent.count({ where: { type: { notIn: KEEP_EVENTS } } }),
    prisma.user.count(),
  ]);
  return { groups, payments, pots, messages, loans, journal, members };
}

export async function resetPilotData(): Promise<PilotCounts> {
  if (!pilotMode()) throw new Error("Refused: the reset only runs on the pilot server (PILOT_SHOW_CODES=true).");
  const before = await countPilotData();
  await prisma.$transaction([
    // CASCADE empties every table linked to the groups. Users, officers and the
    // MFI are not linked here, so they stay.
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "groups", "loan_requests", "record_shares", "staff_alerts", "payment_events" CASCADE',
    ),
    prisma.auditEvent.deleteMany({ where: { type: { notIn: KEEP_EVENTS } } }),
  ]);
  return before;
}
