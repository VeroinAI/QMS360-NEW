CREATE TABLE "replit_provisioning_probe" (
	"id" text PRIMARY KEY DEFAULT 'qms360' NOT NULL,
	"purpose" text DEFAULT 'Detect Replit production database provisioning' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
