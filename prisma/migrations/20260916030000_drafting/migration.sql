-- AlterEnum
ALTER TYPE "IdeaState" ADD VALUE 'DRAFT_FAILED';

-- AlterTable
ALTER TABLE "drops" ADD COLUMN     "queue_ts" TEXT;

-- AlterTable
ALTER TABLE "ideas" ADD COLUMN     "draft_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "draft_cost_usd" DECIMAL(10,5),
ADD COLUMN     "draft_error" TEXT,
ADD COLUMN     "draft_model" TEXT,
ADD COLUMN     "drafted_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ideas_drop_id_product_id_key" ON "ideas"("drop_id", "product_id");

