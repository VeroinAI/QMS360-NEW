ALTER TABLE "app1_qaqc"."notifications" ADD COLUMN "record_type" text;--> statement-breakpoint
ALTER TABLE "app1_qaqc"."notifications" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "app2_lessons"."notifications" ADD COLUMN "record_type" text;--> statement-breakpoint
ALTER TABLE "app2_lessons"."notifications" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "app3_audit"."notifications" ADD COLUMN "record_type" text;--> statement-breakpoint
ALTER TABLE "app3_audit"."notifications" ADD COLUMN "record_id" uuid;