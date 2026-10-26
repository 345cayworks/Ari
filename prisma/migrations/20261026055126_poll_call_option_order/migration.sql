-- The answer-option order each respondent actually heard, by question id,
-- recorded only where it differed from the order as written. Additive and
-- nullable: existing rows pre-date rotation and correctly have no order.
-- AlterTable
ALTER TABLE "PollCall" ADD COLUMN     "optionOrder" JSONB;
