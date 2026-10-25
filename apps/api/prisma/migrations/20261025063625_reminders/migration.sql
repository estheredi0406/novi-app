-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('DAY_BEFORE', 'DUE_DAY');

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminders_roundId_userId_kind_key" ON "reminders"("roundId", "userId", "kind");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
