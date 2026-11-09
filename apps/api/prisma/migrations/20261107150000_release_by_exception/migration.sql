-- D105: pots up to the MFI's limit leave without an officer; above it, two officers approve.
ALTER TABLE "mfis" ADD COLUMN "autoReleaseFcfa" INTEGER DEFAULT 50000;
ALTER TABLE "payouts" ADD COLUMN "firstApprovedById" TEXT,
ADD COLUMN "firstApprovedAt" TIMESTAMP(3);

-- D105: the officer's answer to a payment a member says left her account.
ALTER TABLE "contributions" ADD COLUMN "reportCheckedById" TEXT,
ADD COLUMN "reportRejectedAt" TIMESTAMP(3);
