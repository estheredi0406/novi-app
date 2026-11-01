-- D91: the MFI's credit conditions, preselection and documents.

-- AlterEnum
ALTER TYPE "LoanStatus" ADD VALUE 'PRESELECTED';
ALTER TYPE "LoanStatus" ADD VALUE 'GRANTED';
ALTER TYPE "LoanStatus" ADD VALUE 'NOT_GRANTED';

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('SENT', 'ACCEPTED', 'REDO');

-- AlterTable
ALTER TABLE "loan_requests" ADD COLUMN "requiredDocs" JSONB,
ADD COLUMN "documentsConsentAt" TIMESTAMP(3),
ADD COLUMN "documentsCheckedAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "credit_policies" (
    "mfiId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minCycles" INTEGER NOT NULL DEFAULT 1,
    "minStreak" INTEGER NOT NULL DEFAULT 8,
    "minOnTimePct" INTEGER NOT NULL DEFAULT 90,
    "ceilingTimesPot" INTEGER NOT NULL DEFAULT 3,
    "waitDays" INTEGER NOT NULL DEFAULT 30,
    "months" INTEGER[] DEFAULT ARRAY[3, 6, 12]::INTEGER[],
    "documents" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_policies_pkey" PRIMARY KEY ("mfiId")
);

CREATE TABLE "loan_documents" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_documents_loanId_key_key" ON "loan_documents"("loanId", "key");

-- AddForeignKey
ALTER TABLE "credit_policies" ADD CONSTRAINT "credit_policies_mfiId_fkey" FOREIGN KEY ("mfiId") REFERENCES "mfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
