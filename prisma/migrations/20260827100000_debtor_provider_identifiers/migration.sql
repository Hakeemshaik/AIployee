-- Give a debtor the two identifiers the voice platform actually keys on, so a
-- campaign's calls can be recognised from the record rather than inferred from
-- a phone number alone: the platform's customer uuid (which its conversation
-- records reference as a contact uuid) and the batch code it holds in the
-- record's `call` field.
ALTER TABLE "Debtor" ADD COLUMN "providerContactUuid" TEXT;
ALTER TABLE "Debtor" ADD COLUMN "callBatch" TEXT;
CREATE INDEX "Debtor_organizationId_providerContactUuid_idx" ON "Debtor"("organizationId", "providerContactUuid");
CREATE INDEX "Debtor_organizationId_callBatch_idx" ON "Debtor"("organizationId", "callBatch");
