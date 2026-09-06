ALTER TABLE "shared"."users" ADD COLUMN IF NOT EXISTS "designation" text;
--> statement-breakpoint
ALTER TABLE "shared"."users" ADD COLUMN IF NOT EXISTS "signature_path" text;
--> statement-breakpoint
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD COLUMN IF NOT EXISTS "submitted_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD COLUMN IF NOT EXISTS "reviewed_by_id" uuid;
--> statement-breakpoint
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD COLUMN IF NOT EXISTS "review_decision" text;
--> statement-breakpoint
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD COLUMN IF NOT EXISTS "review_comments" text;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
