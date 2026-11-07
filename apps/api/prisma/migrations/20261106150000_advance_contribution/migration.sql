-- D103: the advance paid with round 1 replaces the 2% reserve.
ALTER TABLE "contributions" ADD COLUMN "advanceFcfa" INTEGER NOT NULL DEFAULT 0;

-- D104: a cover she asked for, its deadline, the organiser's extension, a missed deadline.
ALTER TABLE "reserve_covers" ADD COLUMN "askedAt" TIMESTAMP(3),
ADD COLUMN "dueBy" TIMESTAMP(3),
ADD COLUMN "extendedAt" TIMESTAMP(3),
ADD COLUMN "missedAt" TIMESTAMP(3);

-- D104: in default after a second missed turn.
ALTER TABLE "memberships" ADD COLUMN "defaultedAt" TIMESTAMP(3);
