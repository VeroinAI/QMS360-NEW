CREATE TABLE "shared"."feedback_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"changed_by_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."feedback_status_history" ADD CONSTRAINT "feedback_status_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."feedback_status_history" ADD CONSTRAINT "feedback_status_history_feedback_id_feedback_entries_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "shared"."feedback_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."feedback_status_history" ADD CONSTRAINT "feedback_status_history_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_history_feedback_idx" ON "shared"."feedback_status_history" USING btree ("feedback_id","changed_at");--> statement-breakpoint
CREATE INDEX "feedback_status_history_org_idx" ON "shared"."feedback_status_history" USING btree ("organization_id");