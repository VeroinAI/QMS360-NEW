ALTER TABLE "app3_audit"."audits" ADD COLUMN IF NOT EXISTS "reference_generated" boolean DEFAULT false NOT NULL;
