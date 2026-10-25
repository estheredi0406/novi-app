-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'READY';

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "releasedById" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "receiptConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "receiptDisputedAt" TIMESTAMP(3);
