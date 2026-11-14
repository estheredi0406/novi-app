-- D157: every money notification is kept in the app too, for members whose
-- phone gets no push (the web version, an iPhone) and for those who missed it.
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notices_userId_createdAt_idx" ON "notices"("userId", "createdAt");
ALTER TABLE "notices" ADD CONSTRAINT "notices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
