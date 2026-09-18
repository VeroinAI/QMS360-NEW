CREATE TABLE "shared"."lessons_escalation_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"occurrence_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."lessons_escalation_occurrences" ADD CONSTRAINT "lessons_escalation_occurrences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_escalation_occurrence_unique_idx" ON "shared"."lessons_escalation_occurrences" USING btree ("organization_id","report_key","occurrence_key");