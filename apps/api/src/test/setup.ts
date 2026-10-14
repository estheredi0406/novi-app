import { afterAll, beforeEach } from "vitest";
import { prisma } from "../lib/db.js";
import { sms } from "../providers/index.js";
import { MockSmsProvider } from "../providers/sms/MockSmsProvider.js";

// Before each test: start from empty tables and an empty SMS outbox,
// so no test depends on what another test left behind.
beforeEach(async () => {
  // Guard: never empty any database other than the test one.
  if (!process.env.DATABASE_URL?.includes("/novi_test")) {
    throw new Error("Refusing to empty a database that is not novi_test.");
  }
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE users, devices, sessions, otp_challenges, identity_checks, consents, audit_events CASCADE",
  );
  if (sms instanceof MockSmsProvider) sms.sent.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});