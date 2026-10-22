-- CreateTable
CREATE TABLE "record_shares" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payloadText" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "record_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_views" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "record_shares_userId_issuedAt_idx" ON "record_shares"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "record_views_shareId_viewedAt_idx" ON "record_views"("shareId", "viewedAt");

-- AddForeignKey
ALTER TABLE "record_shares" ADD CONSTRAINT "record_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "record_shares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
