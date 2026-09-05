CREATE TABLE IF NOT EXISTS "app2_lessons"."lesson_approver_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"discipline_id" uuid,
	"categorisation" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app2_lessons"."lesson_approver_scopes" ADD CONSTRAINT "lesson_approver_scopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app2_lessons"."lesson_approver_scopes" ADD CONSTRAINT "lesson_approver_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app2_lessons"."lesson_approver_scopes" ADD CONSTRAINT "lesson_approver_scopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app2_lessons"."lesson_approver_scopes" ADD CONSTRAINT "lesson_approver_scopes_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "app2_lessons"."disciplines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_approver_scope_unique_active_idx" ON "app2_lessons"."lesson_approver_scopes" USING btree ("organization_id","user_id","project_id","discipline_id","categorisation") WHERE "app2_lessons"."lesson_approver_scopes"."deleted_at" IS NULL;
