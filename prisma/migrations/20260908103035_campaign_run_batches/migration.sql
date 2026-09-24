-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "batchSize" INTEGER NOT NULL DEFAULT 150;

-- AlterTable
ALTER TABLE "RedialBatch" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'redial',
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 1;
