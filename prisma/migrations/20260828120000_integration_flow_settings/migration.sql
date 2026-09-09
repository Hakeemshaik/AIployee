-- The dialling flow's ids move out of environment variables and into the
-- database. They are not secrets (they appear in the flow builder's own URL),
-- and holding them in env meant a redeploy for every change.
ALTER TABLE "IntegrationSettings" ADD COLUMN "flowUuid" TEXT;
ALTER TABLE "IntegrationSettings" ADD COLUMN "triggerNodeUuid" TEXT;
ALTER TABLE "IntegrationSettings" ADD COLUMN "callFlag" TEXT;
