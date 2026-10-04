-- DRAFT ONLY. Not registered as a migration, not executed at startup.
-- Review against the actual environment schema and migration ledger first.
-- This is QMS-owned linking storage, NOT Drona master-table DDL.
-- No public tables are created, modified, or populated.
-- No existing UUIDs or business references are changed.
-- Intentionally fail if already applied; reconcile the ledger instead of hiding drift.
BEGIN;

CREATE UNIQUE INDEX drona_users_id_org_link_idx ON shared.users (id, organization_id);
CREATE UNIQUE INDEX drona_projects_id_org_link_idx ON shared.projects (id, organization_id);

CREATE TABLE shared.drona_user_links (
  environment_key text NOT NULL CHECK (environment_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  organization_id uuid NOT NULL,
  external_user_id bigint NOT NULL CHECK (external_user_id > 0),
  user_id uuid NOT NULL,
  review_reference text NOT NULL CHECK (length(btrim(review_reference)) > 0),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_key, organization_id, external_user_id),
  UNIQUE (environment_key, organization_id, user_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES shared.users (id, organization_id),
  FOREIGN KEY (reviewed_by, organization_id) REFERENCES shared.users (id, organization_id)
);

CREATE TABLE shared.drona_project_links (
  environment_key text NOT NULL CHECK (environment_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  organization_id uuid NOT NULL,
  external_project_id bigint NOT NULL CHECK (external_project_id > 0),
  project_id uuid NOT NULL,
  review_reference text NOT NULL CHECK (length(btrim(review_reference)) > 0),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment_key, organization_id, external_project_id),
  UNIQUE (environment_key, organization_id, project_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES shared.projects (id, organization_id),
  FOREIGN KEY (reviewed_by, organization_id) REFERENCES shared.users (id, organization_id)
);

-- Deliberately no FK into public: Drona owns its source lifecycle. Missing source
-- records must revoke access at request time without erasing historical identities.
COMMIT;