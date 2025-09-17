
-- Product: add version with a default for existing rows
ALTER TABLE "Product"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Helpful composite index for OCC match (id + version)
CREATE INDEX IF NOT EXISTS "Product_id_version_idx" ON "Product"("id","version");

-- Membership: add version + updatedAt with defaults so existing rows pass NOT NULL
ALTER TABLE "Membership"
  ADD COLUMN "version"   INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Helpful composite index for OCC match (id + version)
CREATE INDEX IF NOT EXISTS "Membership_id_version_idx" ON "Membership"("id","version");
