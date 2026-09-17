-- Flow 5: an uploaded finished photo — a candidate that never had a round.
-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "theme_id" TEXT,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "ai_generated" BOOLEAN NOT NULL,
    "slack_file_id" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_channel_id" TEXT,
    "message_ts" TEXT,
    "declined_by" TEXT,
    "declined_at" TIMESTAMP(3),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uploads_product_id_uploaded_at_idx" ON "uploads"("product_id", "uploaded_at");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: an image now comes from a candidate or an upload, and says whether AI made it (#16).
ALTER TABLE "images" ADD COLUMN     "upload_id" TEXT,
ADD COLUMN     "ai_generated" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "images_upload_id_key" ON "images"("upload_id");

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
