-- AlterTable
ALTER TABLE "staff_users" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
