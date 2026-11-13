-- D154: why the last transfer of a pot failed, so the console says what to fix.
ALTER TABLE "payouts" ADD COLUMN "failReason" TEXT;
