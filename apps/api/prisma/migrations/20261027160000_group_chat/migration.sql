-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'EVENT');

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "chatReadAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "group_messages" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "event" TEXT,
    "round" INTEGER,
    "hiddenAt" TIMESTAMP(3),
    "hiddenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_messages_groupId_createdAt_idx" ON "group_messages"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
