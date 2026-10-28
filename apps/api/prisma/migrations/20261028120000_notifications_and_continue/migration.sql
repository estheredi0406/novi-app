-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifyChat" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "pushToken" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "chatPushedAt" TIMESTAMP(3),
ADD COLUMN     "continueAnswer" BOOLEAN,
ADD COLUMN     "continueAt" TIMESTAMP(3);
