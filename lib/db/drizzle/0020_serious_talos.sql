CREATE TABLE "app1_qaqc"."qaqc_report_delivery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"run_key" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app1_qaqc"."qaqc_report_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"period" date NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"baseline" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"approver_id" uuid,
	"submitted_by_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"review_comments" text,
	"reference_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_delivery_runs" ADD CONSTRAINT "qaqc_report_delivery_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_delivery_runs" ADD CONSTRAINT "qaqc_report_delivery_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_submissions" ADD CONSTRAINT "qaqc_report_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_submissions" ADD CONSTRAINT "qaqc_report_submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_submissions" ADD CONSTRAINT "qaqc_report_submissions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_submissions" ADD CONSTRAINT "qaqc_report_submissions_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."qaqc_report_submissions" ADD CONSTRAINT "qaqc_report_submissions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qaqc_report_delivery_org_run_key_active_idx" ON "app1_qaqc"."qaqc_report_delivery_runs" USING btree ("organization_id","run_key") WHERE "app1_qaqc"."qaqc_report_delivery_runs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "qaqc_report_project_type_period_active_idx" ON "app1_qaqc"."qaqc_report_submissions" USING btree ("organization_id","project_id","report_type","period") WHERE "app1_qaqc"."qaqc_report_submissions"."deleted_at" IS NULL;