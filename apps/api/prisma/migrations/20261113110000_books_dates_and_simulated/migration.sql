-- D150: each line of the MFI's (simulated) books keeps when the money moved,
-- not only when the books wrote it; a pot or an advance sent by the stand-in
-- says it was simulated.
ALTER TABLE "bank_entries" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "bank_entries" b SET "occurredAt" = COALESCE(c."paidAt", c."requestedAt", b."bookedAt")
  FROM "contributions" c WHERE b."source" = 'CONTRIBUTION' AND b."sourceId" = c."id";
UPDATE "bank_entries" b SET "occurredAt" = COALESCE(p."paidAt", p."createdAt", b."bookedAt")
  FROM "payouts" p WHERE b."source" = 'PAYOUT' AND b."sourceId" = p."id";
UPDATE "bank_entries" b SET "occurredAt" = COALESCE(r."paidAt", r."createdAt", b."bookedAt")
  FROM "reserve_returns" r WHERE b."source" = 'ADVANCE_RETURN' AND b."sourceId" = r."id";

UPDATE "bank_entries" b
  SET "label" = regexp_replace(b."label", '^(Cagnotte tour [0-9]+)', '\1 · envoi simulé')
  FROM "payouts" p
  WHERE b."source" = 'PAYOUT' AND b."sourceId" = p."id"
    AND COALESCE(p."sentVia", 'mfi') <> 'fedapay' AND b."label" NOT LIKE '%envoi simulé%';
UPDATE "bank_entries" b
  SET "label" = b."label" || ' · envoi simulé'
  FROM "reserve_returns" r
  WHERE b."source" = 'ADVANCE_RETURN' AND b."sourceId" = r."id"
    AND COALESCE(r."sentVia", 'mfi') <> 'fedapay' AND b."label" NOT LIKE '%envoi simulé%';

DROP INDEX IF EXISTS "bank_entries_accountId_bookedAt_idx";
CREATE INDEX "bank_entries_accountId_occurredAt_idx" ON "bank_entries"("accountId", "occurredAt");
