/*
  Warnings:

  - You are about to drop the column `fullName` on the `users` table. All the data in the column will be lost.
  - Added the required column `displayName` to the `users` table without a default value. This is not possible if the table is not empty.
  - Added the required column `legalName` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "fullName",
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "legalName" TEXT NOT NULL;
