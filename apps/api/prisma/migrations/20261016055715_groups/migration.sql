-- CreateEnum
CREATE TYPE "GroupState" AS ENUM ('DRAFT', 'PROPOSED', 'STARTING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayoutOrder" AS ENUM ('DRAWN', 'FIXED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ORGANISER', 'MEMBER');

-- CreateEnum
CREATE TYPE "SeatState" AS ENUM ('INVITED', 'ACCEPTED', 'COUNTERED', 'DECLINED', 'REMOVED');

-- CreateTable
CREATE TABLE "mfis" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "GroupState" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "mfiId" TEXT NOT NULL,
    "organiserId" TEXT NOT NULL,
    "mfiAccountRef" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules_versions" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "payoutOrder" "PayoutOrder" NOT NULL DEFAULT 'DRAWN',
    "proposedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rules_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "state" "SeatState" NOT NULL DEFAULT 'INVITED',
    "acceptedVersion" INTEGER,
    "counterNote" TEXT,
    "payoutPosition" INTEGER,
    "invitedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mfis_code_key" ON "mfis"("code");

-- CreateIndex
CREATE INDEX "groups_state_idx" ON "groups"("state");

-- CreateIndex
CREATE UNIQUE INDEX "rules_versions_groupId_version_key" ON "rules_versions"("groupId", "version");

-- CreateIndex
CREATE INDEX "memberships_userId_state_idx" ON "memberships"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_groupId_userId_key" ON "memberships"("groupId", "userId");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_mfiId_fkey" FOREIGN KEY ("mfiId") REFERENCES "mfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_organiserId_fkey" FOREIGN KEY ("organiserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules_versions" ADD CONSTRAINT "rules_versions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules_versions" ADD CONSTRAINT "rules_versions_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
