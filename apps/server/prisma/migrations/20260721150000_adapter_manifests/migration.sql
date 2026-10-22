-- Adapter manifests: instance-level (admin-managed, persisted) and
-- per-campaign override (resolved once at run launch, frozen on the run).
-- See docs/adapter-plugins.md.
ALTER TABLE "Campaign" ADD COLUMN "adapterManifestUrl" TEXT;

ALTER TABLE "WorkflowRun" ADD COLUMN "adapterManifestUrl" TEXT;
ALTER TABLE "WorkflowRun" ADD COLUMN "adapterManifestHash" TEXT;

-- CreateTable
CREATE TABLE "AdapterManifest" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "addedById" TEXT NOT NULL,
    "lastFetchedAt" TIMESTAMP(3),
    "lastHash" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdapterManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdapterManifest_url_key" ON "AdapterManifest"("url");

-- CreateIndex
CREATE INDEX "AdapterManifest_enabled_idx" ON "AdapterManifest"("enabled");

-- AddForeignKey
ALTER TABLE "AdapterManifest" ADD CONSTRAINT "AdapterManifest_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
