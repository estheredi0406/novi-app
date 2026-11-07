-- D111: each SMS, real or simulated; the text only on the pilot (PILOT_SHOW_SMS).
ALTER TABLE "sms_logs" ADD COLUMN "phone" TEXT,
ADD COLUMN "text" TEXT,
ADD COLUMN "real" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "sms_logs_phone_createdAt_idx" ON "sms_logs"("phone", "createdAt");
