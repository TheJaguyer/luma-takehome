-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SetupStage" AS ENUM ('AWAITING_INVITE', 'CONFIRM_APPROVER', 'ASK_HOUSE_STYLE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "DropState" AS ENUM ('IMPORTING', 'AWAITING_THEME', 'DRAFTING', 'OPEN', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportOutcome" AS ENUM ('CREATED', 'UNARCHIVED', 'UNCHANGED', 'CHANGED_NOT_APPLIED');

-- CreateEnum
CREATE TYPE "IdeaMode" AS ENUM ('EXPAND', 'DRAFT', 'OWN');

-- CreateEnum
CREATE TYPE "IdeaState" AS ENUM ('DRAFTING', 'AWAITING_REVIEW', 'APPROVED', 'SKIPPED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RoundState" AS ENUM ('GENERATING', 'AWAITING_DECISION', 'CLOSED');

-- CreateEnum
CREATE TYPE "CandidateState" AS ENUM ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImageOrigin" AS ENUM ('ai', 'photographer');

-- CreateTable
CREATE TABLE "installs" (
    "team_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "setup_stage" "SetupStage" NOT NULL DEFAULT 'AWAITING_INVITE',
    "house_style" TEXT,
    "house_style_skipped" BOOLEAN NOT NULL DEFAULT false,
    "candidates_per_round" INTEGER NOT NULL DEFAULT 4,
    "max_rounds" INTEGER NOT NULL DEFAULT 3,
    "default_model" TEXT NOT NULL DEFAULT 'uni-1',
    "nudge_after_days" INTEGER NOT NULL DEFAULT 3,
    "last_nudge_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installs_pkey" PRIMARY KEY ("team_id")
);

-- CreateTable
CREATE TABLE "approvers" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by" TEXT,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "look" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drops" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "slack_file_id" TEXT NOT NULL,
    "imported_by" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "DropState" NOT NULL DEFAULT 'IMPORTING',
    "theme_answered_at" TIMESTAMP(3),
    "theme_answered_by" TEXT,
    "theme_id" TEXT,
    "report" JSONB,
    "summary_channel_id" TEXT,
    "summary_ts" TEXT,
    "last_daily_post_at" TIMESTAMP(3),
    "last_progress_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "drops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT,
    "category" TEXT,
    "color" TEXT,
    "material" TEXT,
    "price" TEXT,
    "notes" TEXT,
    "sheet_shot_idea" TEXT,
    "photo_url" TEXT,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "current_source_photo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drop_products" (
    "drop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "outcome" "ImportOutcome" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drop_products_pkey" PRIMARY KEY ("drop_id","product_id")
);

-- CreateTable
CREATE TABLE "source_photos" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "original_url" TEXT,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "drop_id" TEXT,
    "theme_id" TEXT,
    "mode" "IdeaMode" NOT NULL,
    "state" "IdeaState" NOT NULL DEFAULT 'DRAFTING',
    "raw_sheet_idea" TEXT,
    "house_style_used" TEXT,
    "theme_look_used" TEXT,
    "model" TEXT,
    "approved_option_id" TEXT,
    "approved_prompt" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "force_reason" TEXT,
    "card_channel_id" TEXT,
    "card_ts" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_options" (
    "id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,

    CONSTRAINT "idea_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "idea_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_photo_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "feedback" TEXT,
    "triggered_by" TEXT NOT NULL,
    "state" "RoundState" NOT NULL DEFAULT 'GENERATING',
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "contact_sheet_key" TEXT,
    "message_channel_id" TEXT,
    "message_ts" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "state" "CandidateState" NOT NULL DEFAULT 'PENDING',
    "luma_id" TEXT,
    "cost_usd" DECIMAL(10,4),
    "storage_key" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_poll_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "theme_id" TEXT,
    "origin" "ImageOrigin" NOT NULL,
    "model" TEXT,
    "public_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sort_key" DOUBLE PRECISION NOT NULL,
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "force_reason" TEXT,
    "revoked_by" TEXT,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "team_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "product_id" TEXT,
    "drop_id" TEXT,
    "data" JSONB,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approvers_team_id_user_id_idx" ON "approvers"("team_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "themes_team_id_name_key" ON "themes"("team_id", "name");

-- CreateIndex
CREATE INDEX "drops_team_id_imported_at_idx" ON "drops"("team_id", "imported_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_current_source_photo_id_key" ON "products"("current_source_photo_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_team_id_sku_key" ON "products"("team_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "source_photos_product_id_version_key" ON "source_photos"("product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_approved_option_id_key" ON "ideas"("approved_option_id");

-- CreateIndex
CREATE INDEX "ideas_team_id_state_idx" ON "ideas"("team_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "idea_options_idea_id_position_key" ON "idea_options"("idea_id", "position");

-- CreateIndex
CREATE INDEX "rounds_state_idx" ON "rounds"("state");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_idea_id_number_key" ON "rounds"("idea_id", "number");

-- CreateIndex
CREATE INDEX "candidates_state_next_poll_at_idx" ON "candidates"("state", "next_poll_at");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_round_id_position_key" ON "candidates"("round_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "images_candidate_id_key" ON "images"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "images_public_key_key" ON "images"("public_key");

-- CreateIndex
CREATE INDEX "images_product_id_revoked_at_idx" ON "images"("product_id", "revoked_at");

-- CreateIndex
CREATE INDEX "events_team_id_at_idx" ON "events"("team_id", "at");

-- CreateIndex
CREATE INDEX "events_product_id_at_idx" ON "events"("product_id", "at");

-- AddForeignKey
ALTER TABLE "approvers" ADD CONSTRAINT "approvers_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "installs"("team_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drops" ADD CONSTRAINT "drops_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_current_source_photo_id_fkey" FOREIGN KEY ("current_source_photo_id") REFERENCES "source_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_products" ADD CONSTRAINT "drop_products_drop_id_fkey" FOREIGN KEY ("drop_id") REFERENCES "drops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drop_products" ADD CONSTRAINT "drop_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_photos" ADD CONSTRAINT "source_photos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_drop_id_fkey" FOREIGN KEY ("drop_id") REFERENCES "drops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_approved_option_id_fkey" FOREIGN KEY ("approved_option_id") REFERENCES "idea_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_options" ADD CONSTRAINT "idea_options_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_source_photo_id_fkey" FOREIGN KEY ("source_photo_id") REFERENCES "source_photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

