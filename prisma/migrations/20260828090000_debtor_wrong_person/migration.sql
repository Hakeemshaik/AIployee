-- A call answered by the wrong person is a contact but not a RIGHT-PARTY
-- contact, and RPC rate is meaningless if the two are counted together. The
-- voice agent already reports it; this is where it lands.
ALTER TABLE "Debtor" ADD COLUMN "wrongPerson" BOOLEAN NOT NULL DEFAULT false;
