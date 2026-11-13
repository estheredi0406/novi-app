-- A loan request carries her declared business; Novi no longer keeps photos
-- of her documents: she brings the originals to sign at the agency.
CREATE TYPE "BusinessKind" AS ENUM ('FABRICS', 'FOOD', 'RESTAURANT', 'BEAUTY', 'OTHER');
CREATE TYPE "BusinessSince" AS ENUM ('UNDER_1Y', 'Y1_TO_3', 'OVER_3Y');

ALTER TABLE "loan_requests"
  ADD COLUMN "businessKind" "BusinessKind",
  ADD COLUMN "businessSince" "BusinessSince",
  ADD COLUMN "weeklySalesFcfa" INTEGER,
  ADD COLUMN "businessPlace" TEXT,
  DROP COLUMN "months",
  DROP COLUMN "documentsConsentAt",
  DROP COLUMN "documentsCheckedAt";

DROP TABLE "loan_documents";
DROP TYPE "DocumentStatus";

ALTER TABLE "credit_policies" DROP COLUMN "months";

-- The old "approved" step sent her to the agency, as "preselected" does now.
UPDATE "loan_requests" SET "status" = 'PRESELECTED' WHERE "status" = 'APPROVED';
ALTER TYPE "LoanStatus" RENAME TO "LoanStatus_old";
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'PRESELECTED', 'GRANTED', 'NOT_GRANTED', 'DECLINED', 'WITHDRAWN');
ALTER TABLE "loan_requests" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "loan_requests" ALTER COLUMN "status" TYPE "LoanStatus" USING ("status"::text::"LoanStatus");
ALTER TABLE "loan_requests" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "LoanStatus_old";
