-- CreateTable
CREATE TABLE "JobixConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "externalId" INTEGER,
    "phone" TEXT NOT NULL,
    "contactName" TEXT,
    "agentUuid" TEXT,
    "agentName" TEXT,
    "flowName" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER,
    "conversion" BOOLEAN NOT NULL DEFAULT false,
    "voicemailFlag" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "sastHour" INTEGER NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobixConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobixTranscript" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "conversationUuid" TEXT NOT NULL,
    "turns" TEXT NOT NULL,
    "userTurns" INTEGER NOT NULL DEFAULT 0,
    "userWords" INTEGER NOT NULL DEFAULT 0,
    "userText" TEXT NOT NULL DEFAULT '',
    "reached" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobixTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "phase" TEXT NOT NULL DEFAULT 'conversations',
    "conversationsFound" INTEGER NOT NULL DEFAULT 0,
    "transcriptsFetched" INTEGER NOT NULL DEFAULT 0,
    "transcriptsCached" INTEGER NOT NULL DEFAULT 0,
    "transcriptsFailed" INTEGER NOT NULL DEFAULT 0,
    "customersFound" INTEGER NOT NULL DEFAULT 0,
    "droppedStale" INTEGER NOT NULL DEFAULT 0,
    "droppedDuplicate" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "workspaceNote" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobixConversation_organizationId_startedAt_idx" ON "JobixConversation"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "JobixConversation_organizationId_phone_idx" ON "JobixConversation"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "JobixConversation_organizationId_uuid_key" ON "JobixConversation"("organizationId", "uuid");

-- CreateIndex
CREATE UNIQUE INDEX "JobixTranscript_conversationId_key" ON "JobixTranscript"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "JobixTranscript_conversationUuid_key" ON "JobixTranscript"("conversationUuid");

-- CreateIndex
CREATE INDEX "JobixTranscript_organizationId_reached_idx" ON "JobixTranscript"("organizationId", "reached");

-- CreateIndex
CREATE INDEX "IngestionRun_organizationId_startedAt_idx" ON "IngestionRun"("organizationId", "startedAt");

-- AddForeignKey
ALTER TABLE "JobixConversation" ADD CONSTRAINT "JobixConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobixTranscript" ADD CONSTRAINT "JobixTranscript_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobixTranscript" ADD CONSTRAINT "JobixTranscript_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "JobixConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
