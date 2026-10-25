import { afterAll, beforeEach } from "vitest";
import { prisma } from "../lib/db.js";
import { sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";
import { resetAddressLimits } from "../routes/auth.js";
import { staffLoginStore } from "../routes/staff.js";

// Before each test: start from empty tables, an empty SMS outbox and empty
// per-address limits, so no test depends on what another test left behind.
beforeEach(async () => {
  // Guard: never empty any database other than the test one.
  if (!process.env.DATABASE_URL?.includes("/novi_test")) {
    throw new Error("Refusing to empty a database that is not novi_test.");
  }
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE users, devices, sessions, otp_challenges, identity_checks, consents, audit_events, mfis, groups, rules_versions, memberships, invites, rounds, contributions, ledger_entries, payment_events, payouts, record_shares, record_views, staff_users, staff_sessions, reminders CASCADE",
  );
  if (sms instanceof MockSmsProvider) sms.sent.length = 0;

  // The rate limiters count requests in memory, which TRUNCATE does not touch.
  resetAddressLimits();
  staffLoginStore.resetAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});