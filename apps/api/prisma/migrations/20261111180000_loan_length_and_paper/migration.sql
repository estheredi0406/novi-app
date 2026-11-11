-- D118: the loan length is agreed at the agency; a document can come on paper.
ALTER TABLE "loan_requests" ALTER COLUMN "months" DROP NOT NULL;
ALTER TYPE "DocumentStatus" ADD VALUE 'PAPER';
