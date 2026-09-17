-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "posted_at" TIMESTAMP(3);

-- Rounds already in Slack count as posted, so the worker doesn't post them again.
UPDATE "rounds" SET "posted_at" = COALESCE("completed_at", "created_at") WHERE "message_ts" IS NOT NULL;
