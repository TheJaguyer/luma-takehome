-- AlterEnum
ALTER TYPE "CandidateState" ADD VALUE 'SUBMITTING';

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "model" TEXT,
ADD COLUMN     "prompt" TEXT;

