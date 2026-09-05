CREATE TABLE IF NOT EXISTS "shared"."connector_field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"source_field" text NOT NULL,
	"target_field" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."connector_field_mappings" ADD CONSTRAINT "connector_field_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shared"."connector_field_mappings" ADD CONSTRAINT "connector_field_mappings_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "shared"."integration_connectors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_field_mappings_connector_idx" ON "shared"."connector_field_mappings" USING btree ("connector_id");
