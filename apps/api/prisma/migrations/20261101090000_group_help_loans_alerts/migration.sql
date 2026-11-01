-- D87, D88, D89: turn swaps, advances from the fund, microloan requests.

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'RESERVE_ADVANCE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'RESERVE_ADVANCE_REPAY';

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('ASKED', 'AGREED', 'DONE', 'DECLINED', 'CANCELLED');
CREATE TYPE "AdvanceStatus" AS ENUM ('ASKED', 'APPROVED', 'SENT', 'PAID', 'REPAID', 'DECLINED', 'CANCELLED');
CREATE TYPE "LoanPurpose" AS ENUM ('STOCK', 'EQUIPMENT', 'OTHER');
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "turn_swaps" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "requesterRound" INTEGER NOT NULL,
    "partnerRound" INTEGER NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'ASKED',
    "answeredAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_swaps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "advances" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'ASKED',
    "organiserApproval" TEXT,
    "memberApproval" TEXT,
    "declinedById" TEXT,
    "releasedById" TEXT,
    "mfiRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "repaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loan_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mfiId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "purpose" "LoanPurpose" NOT NULL,
    "months" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "grantedFcfa" INTEGER,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turn_swaps_groupId_status_idx" ON "turn_swaps"("groupId", "status");
CREATE INDEX "advances_groupId_status_idx" ON "advances"("groupId", "status");
CREATE INDEX "advances_userId_status_idx" ON "advances"("userId", "status");
CREATE INDEX "loan_requests_mfiId_status_idx" ON "loan_requests"("mfiId", "status");
CREATE INDEX "loan_requests_userId_createdAt_idx" ON "loan_requests"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "turn_swaps" ADD CONSTRAINT "turn_swaps_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "turn_swaps" ADD CONSTRAINT "turn_swaps_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "turn_swaps" ADD CONSTRAINT "turn_swaps_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "advances" ADD CONSTRAINT "advances_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "advances" ADD CONSTRAINT "advances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_mfiId_fkey" FOREIGN KEY ("mfiId") REFERENCES "mfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D90: alerts to MFI staff
CREATE TABLE "staff_alerts" (
    "id" TEXT NOT NULL,
    "mfiId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "staff_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_alerts_kind_refId_key" ON "staff_alerts"("kind", "refId");
CREATE INDEX "staff_alerts_mfiId_resolvedAt_idx" ON "staff_alerts"("mfiId", "resolvedAt");
