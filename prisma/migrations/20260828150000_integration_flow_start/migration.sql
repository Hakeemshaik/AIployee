-- How the dialling flow begins. A flow whose entry event is "Insert Customer"
-- dials when an armed customer is written; one driven by its Run node dials
-- when that node is triggered. The platform has to write differently for each,
-- and guessing wrong means a run that never dials anybody.
ALTER TABLE "IntegrationSettings" ADD COLUMN "flowStart" TEXT;
