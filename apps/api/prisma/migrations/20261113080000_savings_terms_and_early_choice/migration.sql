-- D147: the caisse's savings conditions, required before groups and savings;
-- her pot choice made before the group starts.
CREATE TYPE "EarlyWithdrawalRule" AS ENUM ('LOSE_GAINS', 'PENALTY');

ALTER TABLE "savings_policies"
  ADD COLUMN "openingFeeFcfa" INTEGER,
  ADD COLUMN "monthlyFeeFcfa" INTEGER,
  ADD COLUMN "withdrawalFeeFcfa" INTEGER,
  ADD COLUMN "minKeepFcfa" INTEGER,
  ADD COLUMN "earlyRule" "EarlyWithdrawalRule",
  ADD COLUMN "earlyPenaltyBp" INTEGER,
  ADD COLUMN "termsSetAt" TIMESTAMP(3);

ALTER TABLE "memberships"
  ADD COLUMN "potKeepFcfa" INTEGER,
  ADD COLUMN "potPocket" "SavingsPocket",
  ADD COLUMN "potLockMonths" INTEGER,
  ADD COLUMN "potChoiceAt" TIMESTAMP(3);
