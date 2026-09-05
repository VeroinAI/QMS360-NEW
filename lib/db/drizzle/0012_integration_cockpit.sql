ALTER TABLE "shared"."projects" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "shared"."users" ADD COLUMN IF NOT EXISTS "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shared"."import_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "shared"."import_templates" ADD CONSTRAINT "import_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_templates_org_entity_idx" ON "shared"."import_templates" USING btree ("organization_id","entity");
