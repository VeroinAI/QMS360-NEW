-- QMS360 Email Placeholder storage — PostgreSQL / AWS-Drona DBA handoff.
--
-- Schema only. Does NOT copy development records, create placeholder definitions,
-- activate placeholders, reset settings, or modify Drona-owned public tables.
--
-- Actual storage:
--   shared.organization_settings.branding -> 'emailPlaceholders' (JSON array)
-- There is no standalone email_placeholders table in the application.
--
-- Prerequisites:
--   1. Connect to the PostgreSQL database used by the QMS360 API.
--   2. QMS360's shared.organizations table must already be installed.
--   3. The current QMS360 application migrations, users and application audit-log
--      tables remain prerequisites for the complete wizard. This is not a
--      replacement for the full application migration set.
--   4. DBA: review the target and take your normal backup before applying DDL.
--      Run the whole script together. Stop on error; ROLLBACK if necessary.
--
-- This file is an operator handoff, NOT a new Drizzle migration.
-- Reconcile any manually applied objects with the deployment's migration ledger
-- before subsequently replaying repository migrations.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
BEGIN
  IF to_regclass('shared.organizations') IS NULL THEN
    RAISE EXCEPTION
      'QMS360 prerequisite shared.organizations is missing. Apply the approved QMS360 base migrations first.';
  END IF;
END;
$preflight$;

-- Current application-compatible container definition, including all columns
-- read by the settings ORM. CREATE IF NOT EXISTS never replaces existing rows.
CREATE TABLE IF NOT EXISTS shared.organization_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  working_calendar jsonb NOT NULL DEFAULT
    '{"workingDays":["Sunday","Monday","Tuesday","Wednesday","Thursday"],"holidays":[]}'::jsonb,
  locale text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'Asia/Riyadh',
  allowed_email_domains text[] NOT NULL DEFAULT ARRAY[]::text[],
  export_threshold_months integer NOT NULL DEFAULT 6,
  export_threshold_rows integer NOT NULL DEFAULT 10000,
  evidence_limits jsonb NOT NULL DEFAULT
    '{"photoMaxMb":8,"photoMaxWidth":1920,"photoMaxHeight":1080,"videoMaxMb":200,"videoMaxMinutes":3,"docMaxMb":25,"lessonPhotoCountMax":5}'::jsonb,
  document_numbering jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_delivery_policy jsonb NOT NULL DEFAULT
    '{"retentionDays":90,"maxRetries":3,"retryDelayMinutes":15}'::jsonb,
  lessons_escalation_report_job jsonb NOT NULL DEFAULT
    '{"enabled":false,"reportKey":"pending_lessons_approval","frequency":"daily","time":"09:00","weeklyDay":1,"monthlyDay":1,"customIntervalMinutes":1440,"lastRunAt":null,"nextRunAt":null}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_settings_organization_id_organizations_id_fk
    FOREIGN KEY (organization_id) REFERENCES shared.organizations(id)
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- Additive compatibility for an existing baseline settings table.
-- These commands do not overwrite values in columns which already exist.
-- The latter two columns are included because the current wizard's settings
-- ORM reads the complete settings row, even though placeholders live in branding.
ALTER TABLE shared.organization_settings
  ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_delivery_policy jsonb NOT NULL DEFAULT
    '{"retentionDays":90,"maxRetries":3,"retryDelayMinutes":15}'::jsonb,
  ADD COLUMN IF NOT EXISTS lessons_escalation_report_job jsonb NOT NULL DEFAULT
    '{"enabled":false,"reportKey":"pending_lessons_approval","frequency":"daily","time":"09:00","weeklyDay":1,"monthlyDay":1,"customIntervalMinutes":1440,"lastRunAt":null,"nextRunAt":null}'::jsonb;

-- Reject a partial/unexpected pre-existing table rather than report success
-- while leaving the current backend unable to read it.
DO $validate$
DECLARE
  missing_columns text;
BEGIN
  SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
    INTO missing_columns
  FROM (VALUES
    ('id'), ('organization_id'), ('branding'), ('working_calendar'), ('locale'),
    ('timezone'), ('allowed_email_domains'), ('export_threshold_months'),
    ('export_threshold_rows'), ('evidence_limits'), ('document_numbering'),
    ('email_delivery_policy'), ('lessons_escalation_report_job'),
    ('status'), ('deleted_at'), ('created_at'), ('updated_at')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'shared.organization_settings'::regclass
      AND a.attname = required.column_name AND a.attnum > 0 AND NOT a.attisdropped
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION
      'Existing organization_settings is missing baseline columns: %. Reconcile approved application migrations; this transaction will roll back.',
      missing_columns;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'shared.organization_settings'::regclass
      AND attname = 'branding' AND atttypid = 'jsonb'::regtype
      AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Existing branding column must be JSONB NOT NULL. Review existing data before altering its definition.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM shared.organization_settings
    WHERE jsonb_typeof(branding) IS DISTINCT FROM 'object'
       OR (
         branding ? 'emailPlaceholders'
         AND jsonb_typeof(branding -> 'emailPlaceholders') IS DISTINCT FROM 'array'
       )
  ) THEN
    RAISE EXCEPTION 'Existing branding/placeholder JSON has an unexpected shape. Existing data was not replaced; review it before proceeding.';
  END IF;
END;
$validate$;

-- Required by the wizard's ON CONFLICT logic: one non-deleted settings row
-- per organization. If duplicates exist, index creation fails safely; this
-- script deliberately does not delete or combine their data.
CREATE UNIQUE INDEX IF NOT EXISTS organization_settings_org_active_idx
  ON shared.organization_settings USING btree (organization_id)
  WHERE deleted_at IS NULL;

COMMIT;

-- Verification only: no definitions or settings rows are inserted by this file.
-- No settings row / no emailPlaceholders key means an empty registry, which is
-- valid. The wizard creates the organization's settings row when first saved.
SELECT
  organization_id,
  CASE WHEN branding ? 'emailPlaceholders'
    THEN jsonb_array_length(branding -> 'emailPlaceholders')
    ELSE 0
  END AS placeholder_count
FROM shared.organization_settings
WHERE deleted_at IS NULL
ORDER BY organization_id;

-- After DDL:
-- * Keep the API runtime's existing SELECT/INSERT/UPDATE permissions on this
--   settings table. If the DBA creates it under a different owner, explicitly
--   grant those permissions to the actual QMS360 runtime role using your normal
--   privilege process. Do not grant privileges to PUBLIC.
-- * Deploy the matching QMS360 frontend/backend.
-- * Create definitions at Integration Cockpit -> Email placeholders.
--   New definitions start inactive; activate them after review.
-- * A schema-only script does NOT transfer the nine development definitions.
-- * For an already-correct table/index/JSON structure, this script makes no
--   application-data changes. It does not inspect AWS until the DBA runs it.
