/*
  Warnings:

  - A unique constraint covering the columns `[payoutId]` on the table `ledger_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('HELD', 'SENDING', 'SENT', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "payoutId" TEXT;

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "phone" TEXT NOT NULL,
    "operator" "MobileOperator" NOT NULL,
    "mfiRef" TEXT,
    "heldSince" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_roundId_key" ON "payouts"("roundId");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_payoutId_key" ON "ledger_entries"("payoutId");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
