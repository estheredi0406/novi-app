-- AlterTable
ALTER TABLE "record_shares" ADD COLUMN     "mfiId" TEXT;

-- AlterTable
ALTER TABLE "record_views" ADD COLUMN     "staffId" TEXT;

-- CreateIndex
CREATE INDEX "record_shares_mfiId_issuedAt_idx" ON "record_shares"("mfiId", "issuedAt");

-- AddForeignKey
ALTER TABLE "record_shares" ADD CONSTRAINT "record_shares_mfiId_fkey" FOREIGN KEY ("mfiId") REFERENCES "mfis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
