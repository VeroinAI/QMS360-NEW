CREATE UNIQUE INDEX IF NOT EXISTS "connector_field_mappings_live_target_idx" ON "shared"."connector_field_mappings" USING btree ("connector_id", "entity", "target_field") WHERE "deleted_at" IS NULL;
