-- AlterTable
ALTER TABLE "IngestionRun" ADD COLUMN     "messagingEvents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "JobixNodeEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "flowUuid" TEXT NOT NULL,
    "companyNodeId" INTEGER NOT NULL,
    "nodeName" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'other',
    "status" INTEGER NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "outputSocketId" TEXT,
    "matchedFilter" BOOLEAN,
    "customerName" TEXT,
    "customerKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobixNodeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobixNodeEvent_organizationId_customerKey_idx" ON "JobixNodeEvent"("organizationId", "customerKey");

-- CreateIndex
CREATE INDEX "JobixNodeEvent_organizationId_occurredAt_idx" ON "JobixNodeEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobixNodeEvent_organizationId_flowUuid_companyNodeId_custom_key" ON "JobixNodeEvent"("organizationId", "flowUuid", "companyNodeId", "customerKey", "occurredAt");

-- AddForeignKey
ALTER TABLE "JobixNodeEvent" ADD CONSTRAINT "JobixNodeEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
