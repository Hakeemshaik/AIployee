-- One dial, from the moment it is placed to whatever came back.
--
-- The write to the voice platform IS the call, so between pressing the button
-- and a result arriving there was no record that anybody had been rung. The
-- suid is the reference minted for that write; the platform returns it on the
-- outcome webhook, and the transcript, the promise and the recording all hang
-- off that one join.
CREATE TABLE "DialAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "suid" TEXT NOT NULL,
    "debtorId" TEXT,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "callFlag" TEXT NOT NULL,
    "requestedById" TEXT,
    "state" TEXT NOT NULL DEFAULT 'placed',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "outcome" TEXT,
    "transcript" TEXT,
    "recordingUrl" TEXT,
    "callId" TEXT,
    "raw" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DialAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DialAttempt_organizationId_suid_key" ON "DialAttempt"("organizationId", "suid");
CREATE INDEX "DialAttempt_organizationId_requestedAt_idx" ON "DialAttempt"("organizationId", "requestedAt");
CREATE INDEX "DialAttempt_organizationId_debtorId_idx" ON "DialAttempt"("organizationId", "debtorId");

ALTER TABLE "DialAttempt" ADD CONSTRAINT "DialAttempt_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DialAttempt" ADD CONSTRAINT "DialAttempt_debtorId_fkey"
    FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
