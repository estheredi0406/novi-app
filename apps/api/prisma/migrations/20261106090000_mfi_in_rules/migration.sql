-- D95: the MFI that keeps a group's money becomes part of each version of its
-- rules. Existing versions take the MFI their group already has.
ALTER TABLE "rules_versions" ADD COLUMN "mfiId" TEXT;

UPDATE "rules_versions" AS rv
SET "mfiId" = g."mfiId"
FROM "groups" AS g
WHERE g."id" = rv."groupId";

ALTER TABLE "rules_versions" ALTER COLUMN "mfiId" SET NOT NULL;

ALTER TABLE "rules_versions" ADD CONSTRAINT "rules_versions_mfiId_fkey" FOREIGN KEY ("mfiId") REFERENCES "mfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
