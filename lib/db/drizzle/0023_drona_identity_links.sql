CREATE TABLE "shared"."drona_project_links" (
	"environment_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_reference" text NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_project_id" bigint NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "drona_project_links_environment_key_organization_id_external_project_id_pk" PRIMARY KEY("environment_key","organization_id","external_project_id"),
	CONSTRAINT "drona_project_links_environment_org_project_key" UNIQUE("environment_key","organization_id","project_id"),
	CONSTRAINT "drona_project_links_environment_check" CHECK ("shared"."drona_project_links"."environment_key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "drona_project_links_source_id_check" CHECK ("shared"."drona_project_links"."external_project_id" > 0),
	CONSTRAINT "drona_project_links_review_check" CHECK (length(btrim("shared"."drona_project_links"."review_reference")) > 0)
);
--> statement-breakpoint
CREATE TABLE "shared"."drona_user_links" (
	"environment_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_reference" text NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_user_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "drona_user_links_environment_key_organization_id_external_user_id_pk" PRIMARY KEY("environment_key","organization_id","external_user_id"),
	CONSTRAINT "drona_user_links_environment_org_user_key" UNIQUE("environment_key","organization_id","user_id"),
	CONSTRAINT "drona_user_links_environment_check" CHECK ("shared"."drona_user_links"."environment_key" ~ '^[a-z][a-z0-9_-]{1,63}$'),
	CONSTRAINT "drona_user_links_source_id_check" CHECK ("shared"."drona_user_links"."external_user_id" > 0),
	CONSTRAINT "drona_user_links_review_check" CHECK (length(btrim("shared"."drona_user_links"."review_reference")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drona_projects_id_org_link_idx" ON "shared"."projects" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drona_users_id_org_link_idx" ON "shared"."users" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "shared"."drona_project_links" ADD CONSTRAINT "drona_project_links_project_id_organization_id_projects_id_organization_id_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "shared"."projects"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."drona_project_links" ADD CONSTRAINT "drona_project_links_reviewed_by_organization_id_users_id_organization_id_fk" FOREIGN KEY ("reviewed_by","organization_id") REFERENCES "shared"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."drona_user_links" ADD CONSTRAINT "drona_user_links_user_id_organization_id_users_id_organization_id_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "shared"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."drona_user_links" ADD CONSTRAINT "drona_user_links_reviewed_by_organization_id_users_id_organization_id_fk" FOREIGN KEY ("reviewed_by","organization_id") REFERENCES "shared"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint