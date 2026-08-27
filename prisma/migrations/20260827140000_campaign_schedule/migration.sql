-- Let a campaign carry the time it should start dialling, so a run can be set
-- up now and fired later without anybody sitting at the screen. The schedule is
-- cleared once it fires, which is what stops it running twice.
ALTER TABLE "Campaign" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "Campaign" ADD COLUMN "scheduledBy" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "scheduleError" TEXT;
CREATE INDEX "Campaign_scheduledFor_idx" ON "Campaign"("scheduledFor");
