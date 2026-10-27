-- AlterTable
ALTER TABLE "group_messages" ADD COLUMN     "meetingId" TEXT;

-- CreateTable
CREATE TABLE "group_meetings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "roomName" TEXT,
    "roomUrl" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendances" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstJoinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_meetings_roomName_key" ON "group_meetings"("roomName");

-- CreateIndex
CREATE INDEX "group_meetings_groupId_startsAt_idx" ON "group_meetings"("groupId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendances_meetingId_userId_key" ON "meeting_attendances"("meetingId", "userId");

-- AddForeignKey
ALTER TABLE "group_messages" ADD CONSTRAINT "group_messages_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "group_meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_meetings" ADD CONSTRAINT "group_meetings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_meetings" ADD CONSTRAINT "group_meetings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "group_meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendances" ADD CONSTRAINT "meeting_attendances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
