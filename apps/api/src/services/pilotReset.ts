import { prisma } from "../lib/db.js";
import { pilotMode } from "../lib/pilot.js";

// Pilot only (D93): erases every group and everything that happened inside
// one, so testing can start again from a clean console, while keeping the
// people. Members keep their account, verified identity and PIN; officers
// keep their logins; the MFI keeps its credit conditions.
//
// The ledger is append-only (D5): a trigger refuses any row deleted from it.
// TRUNCATE does not fire row triggers, so it is the only way to empty it, and
// it is used here on purpose, once, for test data. A real deployment never
// runs this: it refuses unless the server is in pilot mode.

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
    // CASCADE empties every table that points at these: memberships, rules,
    // invites, rounds, payments, pots, ledger lines, reminders, the caisse,
    // chats and voice notes, meetings, swaps, advances, loan documents and
    // the record shares' views. Users, officers and the MFI point nowhere
    // here, so they stay.
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "groups", "loan_requests", "record_shares", "staff_alerts", "payment_events" CASCADE',
    ),
    prisma.auditEvent.deleteMany({ where: { type: { notIn: KEEP_EVENTS } } }),
  ]);
  return before;
}
