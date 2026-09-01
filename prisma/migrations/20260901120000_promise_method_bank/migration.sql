-- A promise now records how the money is coming and, when it needs one, from
-- which bank. Both nullable: every promise captured before this knows neither,
-- and guessing "eft" for them would be inventing a fact.
ALTER TABLE "PromiseToPay" ADD COLUMN "method" TEXT;
ALTER TABLE "PromiseToPay" ADD COLUMN "bank" TEXT;
