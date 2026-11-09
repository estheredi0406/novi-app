-- D102: each MFI connects its own FedaPay account; payments and pots go through it.
ALTER TABLE "mfis" ADD COLUMN "fedapaySecretKey" TEXT,
ADD COLUMN "fedapayWebhookSecret" TEXT,
ADD COLUMN "fedapayLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fedapayConnectedAt" TIMESTAMP(3),
ADD COLUMN "fedapayPayouts" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "contributions" ADD COLUMN "paymentAccountMfiId" TEXT;

ALTER TABLE "payouts" ADD COLUMN "sentVia" TEXT;
