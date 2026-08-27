-- Store the provider's customer uuid on a call record. Conversations already
-- return it; without it a call could only be tied to a debtor by phone number,
-- which is a guess where two records share a number.
ALTER TABLE "JobixConversation" ADD COLUMN "contactUuid" TEXT;
CREATE INDEX "JobixConversation_organizationId_contactUuid_idx" ON "JobixConversation"("organizationId", "contactUuid");
