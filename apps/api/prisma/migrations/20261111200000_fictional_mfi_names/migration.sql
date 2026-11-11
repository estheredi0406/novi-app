-- D120: Novi has no agreement with FUCEC-Togo, so the pilot's partner MFI
-- takes a fictional name. The row keeps its id, so its groups, officers,
-- FedaPay account and credit conditions stay attached to it.
UPDATE "mfis"
SET "code" = 'MAWULI', "name" = 'Caisse Mawuli'
WHERE "code" = 'FUCEC'
  AND NOT EXISTS (SELECT 1 FROM "mfis" WHERE "code" = 'MAWULI');
