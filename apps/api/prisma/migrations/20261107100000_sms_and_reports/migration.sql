-- She says the money left her mobile money account, though the payment is not confirmed.
ALTER TABLE "contributions" ADD COLUMN "reportedAt" TIMESTAMP(3);

-- Every SMS really sent, to keep each month under the cost limit.
CREATE TABLE "sms_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sms_logs_createdAt_idx" ON "sms_logs"("createdAt");
