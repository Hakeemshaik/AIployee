-- AlterTable
ALTER TABLE "IngestionRun" ADD COLUMN     "customersCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customersUpdated" INTEGER NOT NULL DEFAULT 0;
