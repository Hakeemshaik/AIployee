-- A run that hits the serverless request-duration ceiling must be resumable
-- rather than left looking alive forever: record how much transcript work is
-- left, and stamp every checkpoint so a stalled run can be told from a live one.
ALTER TABLE "IngestionRun" ADD COLUMN "transcriptsPending" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IngestionRun" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
