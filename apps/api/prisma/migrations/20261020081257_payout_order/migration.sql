-- AlterTable
ALTER TABLE "rules_versions" ADD COLUMN     "fixedOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];
