-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "callbackAt" TIMESTAMP(3),
ADD COLUMN     "providerBatchId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "providerCampaignId" TEXT,
ADD COLUMN     "providerError" TEXT,
ADD COLUMN     "providerStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CampaignContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "redialBatchId" TEXT,
    "providerContactId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastOutcome" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "callbackAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedialBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "filter" TEXT NOT NULL,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "providerCampaignId" TEXT,
    "providerError" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RedialBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'jobix',
    "externalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT,
    "callId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "baseUrl" TEXT,
    "endpoints" TEXT,
    "outcomeMap" TEXT,
    "pollEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pollCursor" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignContact_organizationId_campaignId_lastOutcome_idx" ON "CampaignContact"("organizationId", "campaignId", "lastOutcome");

-- CreateIndex
CREATE INDEX "CampaignContact_organizationId_callbackAt_idx" ON "CampaignContact"("organizationId", "callbackAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContact_campaignId_debtorId_key" ON "CampaignContact"("campaignId", "debtorId");

-- CreateIndex
CREATE UNIQUE INDEX "RedialBatch_idempotencyKey_key" ON "RedialBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RedialBatch_organizationId_campaignId_createdAt_idx" ON "RedialBatch"("organizationId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_organizationId_type_createdAt_idx" ON "ProviderEvent"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_provider_externalEventId_key" ON "ProviderEvent"("provider", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSettings_organizationId_key" ON "IntegrationSettings"("organizationId");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_providerCampaignId_idx" ON "Campaign"("organizationId", "providerCampaignId");

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignContact" ADD CONSTRAINT "CampaignContact_redialBatchId_fkey" FOREIGN KEY ("redialBatchId") REFERENCES "RedialBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedialBatch" ADD CONSTRAINT "RedialBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedialBatch" ADD CONSTRAINT "RedialBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSettings" ADD CONSTRAINT "IntegrationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
