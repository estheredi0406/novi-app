-- D149: the advances given back at the end of a cycle are followed like a pot.
ALTER TABLE "reserve_returns"
  ADD COLUMN "requestedAt" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "sentVia" TEXT,
  ADD COLUMN "toldAt" TIMESTAMP(3);

-- Returns written before D149 were asked once already.
UPDATE "reserve_returns" SET "attempts" = 1, "requestedAt" = "createdAt";
UPDATE "reserve_returns" SET "failedAt" = "createdAt" WHERE "status" = 'FAILED';
UPDATE "reserve_returns" SET "toldAt" = "paidAt" WHERE "status" = 'PAID';
