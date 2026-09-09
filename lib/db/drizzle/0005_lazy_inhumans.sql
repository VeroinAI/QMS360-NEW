CREATE TABLE "shared"."feedback_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"feedback_id" uuid NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared"."feedback_attachments" ADD CONSTRAINT "feedback_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."feedback_attachments" ADD CONSTRAINT "feedback_attachments_feedback_id_feedback_entries_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "shared"."feedback_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared"."feedback_attachments" ADD CONSTRAINT "feedback_attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_attachments_feedback_idx" ON "shared"."feedback_attachments" USING btree ("feedback_id");--> statement-breakpoint
CREATE INDEX "feedback_attachments_org_idx" ON "shared"."feedback_attachments" USING btree ("organization_id");