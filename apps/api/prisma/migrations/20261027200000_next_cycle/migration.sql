-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "cycleNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "previousGroupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "groups_previousGroupId_key" ON "groups"("previousGroupId");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_previousGroupId_fkey" FOREIGN KEY ("previousGroupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
