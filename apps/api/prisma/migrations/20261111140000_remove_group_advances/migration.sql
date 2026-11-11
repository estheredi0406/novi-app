-- D115: the emergency advance from the group's money (D88) is removed.
-- Ledger lines already written for it stay (the ledger is append-only, D5),
-- so the two ledger types stay too.
DROP TABLE "advances";
DROP TYPE "AdvanceStatus";
