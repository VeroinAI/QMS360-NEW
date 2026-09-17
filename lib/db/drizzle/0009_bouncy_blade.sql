CREATE TABLE "shared"."email_event_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"event_type" text NOT NULL,
	"created_by_user_id" uuid,
	"receiver_user_id" uuid,
	"receiver_name" text,
	"receiver_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."email_event_rules" ADD CONSTRAINT "email_event_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."email_event_rules" ADD CONSTRAINT "email_event_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."email_event_rules" ADD CONSTRAINT "email_event_rules_receiver_user_id_users_id_fk" FOREIGN KEY ("receiver_user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_event_rules_org_priority_idx" ON "shared"."email_event_rules" USING btree ("organization_id","priority");