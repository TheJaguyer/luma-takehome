-- DropIndex
DROP INDEX "ideas_drop_id_product_id_key";

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "card_shown_at" TIMESTAMP(3),
ADD COLUMN     "supersedes" TEXT;

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "sheet_file_id" TEXT;

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "slack_file_id" TEXT;

-- CreateIndex
CREATE INDEX "ideas_drop_id_product_id_idx" ON "ideas"("drop_id", "product_id");


-- Cards already in Slack count as shown.
UPDATE "ideas" SET "card_shown_at" = "created_at" WHERE "card_ts" IS NOT NULL;
