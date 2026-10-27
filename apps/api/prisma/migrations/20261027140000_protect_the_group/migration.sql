-- CreateEnum
CREATE TYPE "ExitReason" AS ENUM ('DEATH', 'LEFT');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "exitPayoutPhone" TEXT,
ADD COLUMN     "exitReason" "ExitReason",
ADD COLUMN     "exitedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "toNextOfKin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "coverRepaidFcfa" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "reserve_covers" ADD COLUMN     "writtenOffAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "untrustedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinPhone" TEXT,
ADD COLUMN     "nextOfKinRelation" TEXT;
