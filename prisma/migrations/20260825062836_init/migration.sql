-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collector',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "callingHoursStart" TEXT NOT NULL DEFAULT '08:00',
    "callingHoursEnd" TEXT NOT NULL DEFAULT '20:00',
    "callingDays" TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri,sat',
    "maxAttemptsPerDebtor" INTEGER NOT NULL DEFAULT 10,
    "maxAttemptsPerDay" INTEGER NOT NULL DEFAULT 2,
    "retryIntervalHours" INTEGER NOT NULL DEFAULT 48,
    "recordingConsentRequired" BOOLEAN NOT NULL DEFAULT true,
    "recordingDisclosure" TEXT NOT NULL DEFAULT 'This call is recorded for quality and compliance purposes.',
    "escalateOnDispute" BOOLEAN NOT NULL DEFAULT true,
    "escalateOnHardship" BOOLEAN NOT NULL DEFAULT true,
    "escalateOnVulnerable" BOOLEAN NOT NULL DEFAULT true,
    "maxAIArrangementAmount" DOUBLE PRECISION NOT NULL DEFAULT 25000,
    "honourOptOut" BOOLEAN NOT NULL DEFAULT true,
    "freezeContactOnDispute" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ComplianceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debtor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "altPhone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "province" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "riskScore" INTEGER NOT NULL DEFAULT 50,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "campaignId" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "lastOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debtor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "creditorName" TEXT NOT NULL,
    "originalBalance" DOUBLE PRECISION NOT NULL,
    "currentBalance" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "daysOverdue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "segment" TEXT,
    "agentId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "callingHoursStart" TEXT NOT NULL DEFAULT '09:00',
    "callingHoursEnd" TEXT NOT NULL DEFAULT '18:00',
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "retryIntervalHours" INTEGER NOT NULL DEFAULT 48,
    "strategy" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAgent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voiceConfig" TEXT,
    "promptRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalCallId" TEXT,
    "debtorId" TEXT NOT NULL,
    "campaignId" TEXT,
    "agentId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "outcome" TEXT,
    "transcript" TEXT,
    "recordingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallAnalysis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "promisedAmount" DOUBLE PRECISION,
    "promisedDate" TIMESTAMP(3),
    "paymentPlan" TEXT,
    "reasonForNonpayment" TEXT,
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "sentimentScore" DOUBLE PRECISION,
    "requiresHuman" BOOLEAN NOT NULL DEFAULT false,
    "escalationReason" TEXT,
    "nextAction" TEXT,
    "summary" TEXT,
    "keyPoints" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "campaignId" TEXT,
    "callId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "promisedDate" TIMESTAMP(3) NOT NULL,
    "paymentPlan" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "debtAccountId" TEXT,
    "campaignId" TEXT,
    "promiseId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'eft',
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Escalation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "callId" TEXT,
    "campaignId" TEXT,
    "reason" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToUserId" TEXT,
    "notes" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "content" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'insights',
    "refId" TEXT,
    "content" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "dataWindowStart" TIMESTAMP(3),
    "dataWindowEnd" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'voice:ingest',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceSettings_organizationId_key" ON "ComplianceSettings"("organizationId");

-- CreateIndex
CREATE INDEX "Debtor_organizationId_status_idx" ON "Debtor"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Debtor_organizationId_campaignId_idx" ON "Debtor"("organizationId", "campaignId");

-- CreateIndex
CREATE INDEX "Debtor_organizationId_phone_idx" ON "Debtor"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Debtor_organizationId_accountNumber_key" ON "Debtor"("organizationId", "accountNumber");

-- CreateIndex
CREATE INDEX "DebtAccount_organizationId_debtorId_idx" ON "DebtAccount"("organizationId", "debtorId");

-- CreateIndex
CREATE INDEX "DebtAccount_organizationId_daysOverdue_idx" ON "DebtAccount"("organizationId", "daysOverdue");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AIAgent_organizationId_idx" ON "AIAgent"("organizationId");

-- CreateIndex
CREATE INDEX "Call_organizationId_startedAt_idx" ON "Call"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_organizationId_debtorId_idx" ON "Call"("organizationId", "debtorId");

-- CreateIndex
CREATE INDEX "Call_organizationId_campaignId_idx" ON "Call"("organizationId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_organizationId_externalCallId_key" ON "Call"("organizationId", "externalCallId");

-- CreateIndex
CREATE UNIQUE INDEX "CallAnalysis_callId_key" ON "CallAnalysis"("callId");

-- CreateIndex
CREATE INDEX "CallAnalysis_organizationId_outcome_idx" ON "CallAnalysis"("organizationId", "outcome");

-- CreateIndex
CREATE INDEX "PromiseToPay_organizationId_status_idx" ON "PromiseToPay"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PromiseToPay_organizationId_promisedDate_idx" ON "PromiseToPay"("organizationId", "promisedDate");

-- CreateIndex
CREATE INDEX "PromiseToPay_organizationId_debtorId_idx" ON "PromiseToPay"("organizationId", "debtorId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paidAt_idx" ON "Payment"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_debtorId_idx" ON "Payment"("organizationId", "debtorId");

-- CreateIndex
CREATE INDEX "Escalation_organizationId_status_idx" ON "Escalation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Escalation_organizationId_priority_idx" ON "Escalation"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "Report_organizationId_type_idx" ON "Report"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Report_organizationId_createdAt_idx" ON "Report"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIInsight_organizationId_scope_generatedAt_idx" ON "AIInsight"("organizationId", "scope", "generatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "PlatformEvent_organizationId_type_createdAt_idx" ON "PlatformEvent"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformEvent_organizationId_entityId_idx" ON "PlatformEvent"("organizationId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSettings" ADD CONSTRAINT "ComplianceSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debtor" ADD CONSTRAINT "Debtor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debtor" ADD CONSTRAINT "Debtor_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAccount" ADD CONSTRAINT "DebtAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAccount" ADD CONSTRAINT "DebtAccount_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAgent" ADD CONSTRAINT "AIAgent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAnalysis" ADD CONSTRAINT "CallAnalysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAnalysis" ADD CONSTRAINT "CallAnalysis_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_debtAccountId_fkey" FOREIGN KEY ("debtAccountId") REFERENCES "DebtAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_promiseId_fkey" FOREIGN KEY ("promiseId") REFERENCES "PromiseToPay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformEvent" ADD CONSTRAINT "PlatformEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
