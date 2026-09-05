ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD COLUMN IF NOT EXISTS "approver_id" uuid;
ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD COLUMN IF NOT EXISTS "submitted_by_id" uuid;
ALTER TABLE "app1_qaqc"."quality_assessment_briefs" ADD COLUMN IF NOT EXISTS "approver_id" uuid;
ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD CONSTRAINT "qaqc_metric_entries_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD CONSTRAINT "qaqc_metric_entries_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."quality_assessment_briefs" ADD CONSTRAINT "quality_assessment_briefs_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
