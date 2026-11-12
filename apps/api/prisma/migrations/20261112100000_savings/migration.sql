-- D123: her savings at the MFI (a pot, or part of it, kept instead of sent).

CREATE TYPE "SavingsStatus" AS ENUM ('REQUESTED', 'OPEN', 'REFUSED');
CREATE TYPE "SavingsPocket" AS ENUM ('FREE', 'LOCKED');
CREATE TYPE "SavingsEntryKind" AS ENUM ('POT_KEPT', 'WITHDRAWAL');

ALTER TABLE "payouts" ADD COLUMN "keptFcfa" INTEGER;

CREATE TABLE "savings_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mfiId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" "SavingsStatus" NOT NULL DEFAULT 'REQUESTED',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "refusedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "savings_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "savings_accounts_ref_key" ON "savings_accounts"("ref");
CREATE UNIQUE INDEX "savings_accounts_userId_mfiId_key" ON "savings_accounts"("userId", "mfiId");
CREATE INDEX "savings_accounts_mfiId_status_idx" ON "savings_accounts"("mfiId", "status");
ALTER TABLE "savings_accounts" ADD CONSTRAINT "savings_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "savings_accounts" ADD CONSTRAINT "savings_accounts_mfiId_fkey" FOREIGN KEY ("mfiId") REFERENCES "mfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "savings_entries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "SavingsEntryKind" NOT NULL,
    "pocket" "SavingsPocket" NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "rateBp" INTEGER,
    "lockMonths" INTEGER,
    "unlockAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "brokenAt" TIMESTAMP(3),
    "mfiRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "savings_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "savings_entries_payoutId_key" ON "savings_entries"("payoutId");
CREATE INDEX "savings_entries_accountId_createdAt_idx" ON "savings_entries"("accountId", "createdAt");
ALTER TABLE "savings_entries" ADD CONSTRAINT "savings_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "savings_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pot_choices" (
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keepFcfa" INTEGER NOT NULL,
    "pocket" "SavingsPocket" NOT NULL,
    "lockMonths" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pot_choices_pkey" PRIMARY KEY ("roundId")
);

CREATE TABLE "savings_policies" (
    "mfiId" TEXT NOT NULL,
    "freeBp" INTEGER,
    "lock3Bp" INTEGER,
    "lock6Bp" INTEGER,
    "lock12Bp" INTEGER,
    "requireForLoan" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "savings_policies_pkey" PRIMARY KEY ("mfiId")
);
