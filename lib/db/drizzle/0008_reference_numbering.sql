ALTER TABLE "shared"."organization_settings" ADD COLUMN IF NOT EXISTS "document_numbering" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD COLUMN IF NOT EXISTS "reference_number" text;
CREATE UNIQUE INDEX IF NOT EXISTS "qaqc_metric_reference_active_idx" ON "app1_qaqc"."qaqc_metric_entries" ("organization_id", "reference_number") WHERE "deleted_at" IS NULL AND "reference_number" IS NOT NULL;
