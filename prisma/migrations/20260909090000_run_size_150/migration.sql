-- A run is 150 accounts, not 200: the number an operator can watch through and
-- read the results of in one sitting.
ALTER TABLE "Campaign" ALTER COLUMN "batchSize" SET DEFAULT 150;

-- Campaigns still carrying the old default move with it. A campaign that is
-- already dialling keeps its shape — its cut batches have frozen membership,
-- and changing the size underneath a live run would make the plan a lie.
UPDATE "Campaign"
   SET "batchSize" = 150
 WHERE "batchSize" = 200
   AND "engineStatus" IN ('none', 'draft', 'ready');
