-- D121: the second pilot MFI is Caisse Dzidzo (Ewe for "joy"). It may exist
-- on the server as "MFI de démonstration" (DEMO) or as Caisse Kara (KARA,
-- D120); either row is renamed and keeps its id, so its groups, officers and
-- accounts stay attached. Members never see a "demo" label or a place name
-- that reads as a region.
UPDATE "mfis"
SET "code" = 'DZIDZO', "name" = 'Caisse Dzidzo'
WHERE "code" = 'DEMO'
  AND NOT EXISTS (SELECT 1 FROM "mfis" WHERE "code" = 'DZIDZO');

UPDATE "mfis"
SET "code" = 'DZIDZO', "name" = 'Caisse Dzidzo'
WHERE "code" = 'KARA'
  AND NOT EXISTS (SELECT 1 FROM "mfis" WHERE "code" = 'DZIDZO');
