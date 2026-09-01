-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "batchSize" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "currentRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "engineBlock" TEXT,
ADD COLUMN     "engineStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "maxConcurrency" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "maxRounds" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "IngestionRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EngineAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "debtorId" TEXT,
    "suid" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "greetingName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "unitNumber" TEXT,
    "buildingName" TEXT,
    "tenantCode" TEXT,
    "totalDue" INTEGER NOT NULL,
    "unitsHeld" INTEGER NOT NULL DEFAULT 1,
    "multiUnit" BOOLEAN NOT NULL DEFAULT false,
    "sourceFile" TEXT,
    "sourceRow" INTEGER,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "outcome" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "accountIds" TEXT NOT NULL,
    "accountCount" INTEGER NOT NULL,
    "arrears" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "uploadRef" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "zeroRate" DOUBLE PRECISION,
    "countsAttempt" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "conversationUuid" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "userTurns" INTEGER NOT NULL DEFAULT 0,
    "userWords" INTEGER NOT NULL DEFAULT 0,
    "agentWords" INTEGER NOT NULL DEFAULT 0,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "reach" TEXT NOT NULL,
    "substantive" BOOLEAN NOT NULL DEFAULT false,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "EngineAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineAccount_campaignId_state_idx" ON "EngineAccount"("campaignId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "EngineAccount_campaignId_phone_key" ON "EngineAccount"("campaignId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "EngineAccount_organizationId_suid_key" ON "EngineAccount"("organizationId", "suid");

-- CreateIndex
CREATE UNIQUE INDEX "EngineBatch_idempotencyKey_key" ON "EngineBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EngineBatch_campaignId_round_index_idx" ON "EngineBatch"("campaignId", "round", "index");

-- CreateIndex
CREATE UNIQUE INDEX "EngineBatch_campaignId_code_key" ON "EngineBatch"("campaignId", "code");

-- CreateIndex
CREATE INDEX "EngineAttempt_campaignId_round_idx" ON "EngineAttempt"("campaignId", "round");

-- CreateIndex
CREATE INDEX "EngineAttempt_accountId_round_idx" ON "EngineAttempt"("accountId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "EngineAttempt_organizationId_conversationUuid_key" ON "EngineAttempt"("organizationId", "conversationUuid");

-- CreateIndex
CREATE INDEX "EngineAlert_campaignId_acknowledgedAt_idx" ON "EngineAlert"("campaignId", "acknowledgedAt");

-- AddForeignKey
ALTER TABLE "EngineAccount" ADD CONSTRAINT "EngineAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAccount" ADD CONSTRAINT "EngineAccount_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAccount" ADD CONSTRAINT "EngineAccount_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineBatch" ADD CONSTRAINT "EngineBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineBatch" ADD CONSTRAINT "EngineBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAttempt" ADD CONSTRAINT "EngineAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAttempt" ADD CONSTRAINT "EngineAttempt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EngineAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAttempt" ADD CONSTRAINT "EngineAttempt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EngineBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAlert" ADD CONSTRAINT "EngineAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineAlert" ADD CONSTRAINT "EngineAlert_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live attempt per account per round. Voided attempts (a batch written off
-- as a run-level delivery failure) stay for the record but do not hold the
-- lock, because the whole point of voiding is that the batch may be re-run.
-- Prisma cannot express a partial unique index, so it lives here.
CREATE UNIQUE INDEX "EngineAttempt_account_round_live"
  ON "EngineAttempt"("accountId", "round")
  WHERE "voided" = false;
