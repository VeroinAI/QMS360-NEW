DO $$ BEGIN
	CREATE TYPE "shared"."field_access_level" AS ENUM('editable', 'read_only');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shared"."module_field_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"module" "shared"."executive_app_key" NOT NULL,
	"form_key" text NOT NULL,
	"field_key" text NOT NULL,
	"access" "shared"."field_access_level" DEFAULT 'editable' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "shared"."module_field_settings" ADD CONSTRAINT "module_field_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "module_field_settings_org_module_form_field_active_idx" ON "shared"."module_field_settings" USING btree ("organization_id","module","form_key","field_key") WHERE "shared"."module_field_settings"."deleted_at" IS NULL;
