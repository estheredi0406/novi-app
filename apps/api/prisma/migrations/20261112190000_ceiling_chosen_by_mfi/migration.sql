-- D134: the automatic release ceiling is the MFI's choice; Novi sets none.
ALTER TABLE "mfis" ADD COLUMN "autoReleaseChosenAt" TIMESTAMP(3);
ALTER TABLE "mfis" ALTER COLUMN "autoReleaseFcfa" DROP DEFAULT;

-- An MFI whose administrator already set the ceiling keeps it, dated from
-- that choice; the others lose Novi's former 50 000 F default and choose.
UPDATE "mfis" m SET "autoReleaseChosenAt" = c."at"
FROM (
  SELECT s."mfiId", MAX(a."createdAt") AS "at"
  FROM "audit_events" a
  JOIN "staff_users" s ON s."id" = a."details"->>'staffId'
  WHERE a."type" = 'STAFF_AUTO_RELEASE_SET'
  GROUP BY s."mfiId"
) c
WHERE c."mfiId" = m."id";
UPDATE "mfis" SET "autoReleaseFcfa" = NULL WHERE "autoReleaseChosenAt" IS NULL;
