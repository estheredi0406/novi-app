-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'RESERVE_IN';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RESERVE_COVER';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RESERVE_REPAY';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RESERVE_RETURN';

-- CreateTable
CREATE TABLE "reserve_covers" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "coveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repaidAt" TIMESTAMP(3),

    CONSTRAINT "reserve_covers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserve_returns" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "operator" "MobileOperator" NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "mfiRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserve_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reserve_covers_roundId_userId_key" ON "reserve_covers"("roundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "reserve_returns_groupId_userId_key" ON "reserve_returns"("groupId", "userId");

-- AddForeignKey
ALTER TABLE "reserve_covers" ADD CONSTRAINT "reserve_covers_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_covers" ADD CONSTRAINT "reserve_covers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_returns" ADD CONSTRAINT "reserve_returns_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserve_returns" ADD CONSTRAINT "reserve_returns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
