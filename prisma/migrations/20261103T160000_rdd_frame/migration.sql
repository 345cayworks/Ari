-- The random-digit-dial sampling frame.
--
-- Two parts: credentials for the external frame worker (RddSource), and the
-- provenance of a batch drawn from it (PollBatch.rdd*). Nothing here stores a
-- telephone number: the frame holds the plaintext, this platform holds only
-- HMACs, and the columns below are deliberately either aggregates or counts.
-- See docs/rdd-sampling-frame.md and the write-back contract in
-- lib/polling/rdd.ts.

-- CreateTable
CREATE TABLE "RddSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "liveDisposition" TEXT NOT NULL DEFAULT 'live',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RddSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RddSource_tenantId_key" ON "RddSource"("tenantId");

-- AddForeignKey
ALTER TABLE "RddSource" ADD CONSTRAINT "RddSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- Every column is nullable or defaulted: existing batches were uploaded lists,
-- and a null rddSampleId is what says so.
ALTER TABLE "PollBatch"
    ADD COLUMN "rddSampleId" TEXT,
    ADD COLUMN "rddSeed" TEXT,
    ADD COLUMN "rddTargetLive" INTEGER,
    ADD COLUMN "rddTargetSize" INTEGER,
    ADD COLUMN "rddActualSize" INTEGER,
    ADD COLUMN "rddCandidatePool" INTEGER,
    ADD COLUMN "rddShortfall" INTEGER,
    ADD COLUMN "rddAssignmentRate" DOUBLE PRECISION,
    ADD COLUMN "rddOperatorMix" JSONB,
    ADD COLUMN "rddReportedAt" TIMESTAMP(3),
    ADD COLUMN "rddReportedUnassigned" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "rddReportedLive" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "PollBatch_rddSampleId_idx" ON "PollBatch"("rddSampleId");
