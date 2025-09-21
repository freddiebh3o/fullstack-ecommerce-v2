/*
  Warnings:

  - Added the required column `updatedAt` to the `Domain` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."DomainStatus" AS ENUM ('PENDING', 'VERIFIED');

-- AlterTable
ALTER TABLE "public"."Domain" ADD COLUMN     "status" "public"."DomainStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verificationToken" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Domain_tenantId_idx" ON "public"."Domain"("tenantId");

-- One primary domain per tenant
CREATE UNIQUE INDEX IF NOT EXISTS "one_primary_domain_per_tenant"
ON "Domain" ("tenantId")
WHERE "isPrimary" = TRUE;