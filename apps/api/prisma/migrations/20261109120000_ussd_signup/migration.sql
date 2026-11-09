-- D106: a sign-up by USSD in progress, between the two calls.
CREATE TABLE "ussd_signups" (
    "phone" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "transactionId" TEXT NOT NULL,
    "niuKeyedHash" TEXT NOT NULL,
    "idConsentAt" TIMESTAMP(3) NOT NULL,
    "legalName" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedSession" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ussd_signups_pkey" PRIMARY KEY ("phone")
);
