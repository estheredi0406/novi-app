-- D113: the MFI's banking system, simulated: one account per group, and its statement.
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "mfiId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "balanceFcfa" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_accounts_groupId_key" ON "bank_accounts"("groupId");
CREATE UNIQUE INDEX "bank_accounts_ref_key" ON "bank_accounts"("ref");
CREATE INDEX "bank_accounts_mfiId_idx" ON "bank_accounts"("mfiId");

CREATE TABLE "bank_entries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "balanceAfterFcfa" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_entries_source_sourceId_key" ON "bank_entries"("source", "sourceId");
CREATE INDEX "bank_entries_accountId_bookedAt_idx" ON "bank_entries"("accountId", "bookedAt");
ALTER TABLE "bank_entries" ADD CONSTRAINT "bank_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
