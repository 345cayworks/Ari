-- CreateEnum
CREATE TYPE "PollDeliveryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DUPLICATE', 'REFUSED', 'FAILED');

-- CreateTable
CREATE TABLE "PollDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'default',
    "sequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "PollDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "detail" TEXT,
    "missing" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PollDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PollDelivery_tenantId_status_idx" ON "PollDelivery"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PollDelivery_pollId_idx" ON "PollDelivery"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "PollDelivery_target_sequence_key" ON "PollDelivery"("target", "sequence");

-- AddForeignKey
ALTER TABLE "PollDelivery" ADD CONSTRAINT "PollDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollDelivery" ADD CONSTRAINT "PollDelivery_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

