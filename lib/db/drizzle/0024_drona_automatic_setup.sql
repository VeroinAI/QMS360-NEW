CREATE TABLE "shared"."drona_provisioning_history" (
	"environment_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" bigint NOT NULL,
	"internal_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drona_provisioning_history_environment_key_organization_id_kind_external_id_pk" PRIMARY KEY("environment_key","organization_id","kind","external_id"),
	CONSTRAINT "drona_provisioning_history_internal_key" UNIQUE("environment_key","organization_id","kind","internal_id"),
	CONSTRAINT "drona_provisioning_history_kind_check" CHECK ("shared"."drona_provisioning_history"."kind" IN ('user', 'project')),
	CONSTRAINT "drona_provisioning_history_environment_check" CHECK ("shared"."drona_provisioning_history"."environment_key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "drona_provisioning_history_id_check" CHECK ("shared"."drona_provisioning_history"."external_id" > 0)
);
--> statement-breakpoint
ALTER TABLE "shared"."drona_provisioning_history" ADD CONSTRAINT "drona_provisioning_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Remember existing reviewed links before automatic setup is enabled. Deleting
-- a live link remains revocation rather than an invitation to recreate it.
INSERT INTO "shared"."drona_provisioning_history"
  ("environment_key", "organization_id", "kind", "external_id", "internal_id")
SELECT "environment_key", "organization_id", 'user', "external_user_id", "user_id"
FROM "shared"."drona_user_links"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "shared"."drona_provisioning_history"
  ("environment_key", "organization_id", "kind", "external_id", "internal_id")
SELECT "environment_key", "organization_id", 'project', "external_project_id", "project_id"
FROM "shared"."drona_project_links"
ON CONFLICT DO NOTHING;