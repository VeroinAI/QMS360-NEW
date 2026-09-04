CREATE TABLE IF NOT EXISTS "shared"."feedback_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"app_key" text,
	"page_path" text,
	"category" text DEFAULT 'issue' NOT NULL,
	"message" text NOT NULL,
	"triage" jsonb,
	"resolution" text DEFAULT 'open' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."feedback_entries" ADD CONSTRAINT "feedback_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shared"."feedback_entries" ADD CONSTRAINT "feedback_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
