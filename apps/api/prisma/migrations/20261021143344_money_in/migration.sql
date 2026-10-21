-- CreateEnum
CREATE TYPE "MobileOperator" AS ENUM ('MOOV_TG', 'TOGOCEL');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CONTRIBUTION', 'PAYOUT', 'CORRECTION');

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "operator" "MobileOperator" NOT NULL,
    "payerPhone" TEXT NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "roundId" TEXT,
    "userId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amountFcfa" INTEGER NOT NULL,
    "contributionId" TEXT,
    "correctsId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "providerRef" TEXT,
    "body" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rounds_groupId_number_key" ON "rounds"("groupId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_providerRef_key" ON "contributions"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_roundId_userId_key" ON "contributions"("roundId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_contributionId_key" ON "ledger_entries"("contributionId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_correctsId_key" ON "ledger_entries"("correctsId");

-- CreateIndex
CREATE INDEX "ledger_entries_groupId_createdAt_idx" ON "ledger_entries"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_bodyHash_key" ON "payment_events"("bodyHash");

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Added by hand (D46): the ledger is append-only, enforced by the database
-- itself. Any UPDATE or DELETE of a ledger line is refused, even by a bug in
-- the API or by someone with database access through the app's user. A
-- mistake is fixed by adding a CORRECTION line. (TRUNCATE, used only by the
-- test setup on the novi_test database, does not fire row triggers.)
CREATE FUNCTION refuse_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only (D5): % refused', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();
