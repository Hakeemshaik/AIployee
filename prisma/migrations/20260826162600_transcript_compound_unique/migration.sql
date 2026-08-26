/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,conversationUuid]` on the table `JobixTranscript` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "JobixTranscript_organizationId_conversationUuid_key" ON "JobixTranscript"("organizationId", "conversationUuid");
