-- D114: exceptions handled automatically before an officer sees them.
ALTER TABLE "contributions" ADD COLUMN "autoChecks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN "escalatedAt" TIMESTAMP(3);

-- Payments already reported stay in the officers' list.
UPDATE "contributions" SET "escalatedAt" = "reportedAt" WHERE "reportedAt" IS NOT NULL AND "status" <> 'PAID';

ALTER TABLE "payouts" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "receiptCheck" TEXT,
ADD COLUMN "receiptCheckedAt" TIMESTAMP(3);

-- Transfers already refused count as tried once, refused now.
UPDATE "payouts" SET "attempts" = 1, "failedAt" = "updatedAt" WHERE "status" = 'FAILED';
UPDATE "payouts" SET "attempts" = 1 WHERE "status" IN ('SENDING', 'SENT', 'PAID');
