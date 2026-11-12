-- D125: a member starts saving at the MFI before she asks for a loan, unless
-- the MFI turns it off in the console. Rows already saved keep their choice.
ALTER TABLE "savings_policies" ALTER COLUMN "requireForLoan" SET DEFAULT true;
