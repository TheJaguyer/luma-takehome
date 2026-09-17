-- AlterTable
ALTER TABLE "installs" ADD COLUMN     "setup_started_by" TEXT;

-- AlterTable
ALTER TABLE "drops" ADD COLUMN     "channel_id" TEXT NOT NULL,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "thread_ts" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "drop_products" ADD COLUMN     "changes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "draft_idea" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "drops_slack_file_id_thread_ts_key" ON "drops"("slack_file_id", "thread_ts");

