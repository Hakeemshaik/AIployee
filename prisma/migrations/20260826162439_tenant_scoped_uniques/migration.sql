/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,provider,externalEventId]` on the table `ProviderEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "JobixTranscript_conversationUuid_key";

-- DropIndex
DROP INDEX "ProviderEvent_provider_externalEventId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_organizationId_provider_externalEventId_key" ON "ProviderEvent"("organizationId", "provider", "externalEventId");
