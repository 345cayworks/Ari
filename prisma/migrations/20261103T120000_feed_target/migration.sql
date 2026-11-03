-- CreateTable
CREATE TABLE "FeedTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedTarget_tenantId_revokedAt_idx" ON "FeedTarget"("tenantId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedTarget_tenantId_target_key" ON "FeedTarget"("tenantId", "target");

-- AddForeignKey
ALTER TABLE "FeedTarget" ADD CONSTRAINT "FeedTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

