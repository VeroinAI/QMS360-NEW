CREATE TABLE "shared"."outbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"app" text NOT NULL,
	"event_type" text,
	"rule_id" uuid,
	"entity_id" text,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivery_status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."organization_settings" ADD COLUMN "email_delivery_policy" jsonb DEFAULT '{"retentionDays":90,"maxRetries":3,"retryDelayMinutes":15}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shared"."outbound_emails" ADD CONSTRAINT "outbound_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."outbound_emails" ADD CONSTRAINT "outbound_emails_rule_id_email_event_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "shared"."email_event_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_emails_org_created_idx" ON "shared"."outbound_emails" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_emails_status_next_idx" ON "shared"."outbound_emails" USING btree ("delivery_status","next_attempt_at");