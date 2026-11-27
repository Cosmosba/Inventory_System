-- Stage 5.6 — Maintenance and Repairs
-- Adds startedDate column and partial unique index to maintenance_records.

-- D2: nullable startedDate — set by server when status transitions to IN_PROGRESS
ALTER TABLE "maintenance_records"
  ADD COLUMN "startedDate" DATE;

-- D3: one open maintenance record per asset at a time
-- Predicate: open = not RESOLVED and not CANCELLED
CREATE UNIQUE INDEX "maintenance_records_one_open_per_asset"
  ON "maintenance_records" ("assetId")
  WHERE "status" NOT IN ('RESOLVED', 'CANCELLED');
