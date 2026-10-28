-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "group_messages" ADD COLUMN     "voiceMs" INTEGER;

-- AlterTable
ALTER TABLE "group_meetings" ADD COLUMN     "instant" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "voice_notes" (
    "messageId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "audio" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_notes_pkey" PRIMARY KEY ("messageId")
);

-- AddForeignKey
ALTER TABLE "voice_notes" ADD CONSTRAINT "voice_notes_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "group_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
