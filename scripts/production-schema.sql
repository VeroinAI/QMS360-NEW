CREATE SCHEMA "app1_qaqc";

CREATE SCHEMA "app2_lessons";

CREATE SCHEMA "app3_audit";

CREATE SCHEMA "shared";

CREATE TYPE "app3_audit"."car_extension_status" AS ENUM('none', 'requested', 'approved', 'rejected');
CREATE TYPE "shared"."executive_app_key" AS ENUM('qaqc', 'lessons', 'audit');
CREATE TABLE "app1_qaqc"."ai_suggestion_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"feature_key" text NOT NULL,
	"prompt" text NOT NULL,
	"response" text,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"duration_ms" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."categorisation_risk_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"impact" text,
	"risk_level" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."customer_satisfaction_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period" date NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feedback" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."disciplines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."distribution_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"cadence" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."document_governance_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period" date NOT NULL,
	"discipline_id" uuid,
	"entity" text NOT NULL,
	"status_value" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"average_review_days" numeric(10, 2) DEFAULT '0' NOT NULL,
	"pending_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."escalation_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"rule_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"breached_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);

CREATE TABLE "app1_qaqc"."escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"trigger_key" text NOT NULL,
	"priority" text,
	"sla_working_days" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"repeat_cadence_days" integer,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"business_unit_id" uuid,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"uploaded_by_id" uuid NOT NULL,
	"status" "app1_qaqc"."evidence_status" DEFAULT 'uploading' NOT NULL,
	"client_reference" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."material_inspection_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period" date NOT NULL,
	"mirn_total" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"on_hold_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"hazardous_count" integer DEFAULT 0 NOT NULL,
	"handle_with_care_count" integer DEFAULT 0 NOT NULL,
	"osd_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_template" text NOT NULL,
	"channel" "app1_qaqc"."notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."platform_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform_role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"grant" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."platform_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."qaqc_metric_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period" date NOT NULL,
	"category" text NOT NULL,
	"issued_count" integer DEFAULT 0 NOT NULL,
	"closed_count" integer DEFAULT 0 NOT NULL,
	"ageing_0_to_15" integer DEFAULT 0 NOT NULL,
	"ageing_15_to_45" integer DEFAULT 0 NOT NULL,
	"ageing_over_45" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."qtbt_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period" date NOT NULL,
	"talk_count" integer DEFAULT 0 NOT NULL,
	"attendance_count" integer DEFAULT 0 NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."quality_assessment_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reporting_period" date NOT NULL,
	"narrative" text,
	"ai_draft" text,
	"ai_review_state" text,
	"workflow_state" text DEFAULT 'draft' NOT NULL,
	"submitted_by_id" uuid,
	"approved_by_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."target_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"target_value" numeric(10, 2) NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."user_workspace_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_role_id" uuid NOT NULL,
	"business_unit_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"project_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."workspace_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"grant" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app1_qaqc"."workspace_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."escalation_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"rule_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"breached_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);

CREATE TABLE "app2_lessons"."escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"trigger_key" text NOT NULL,
	"priority" text,
	"sla_working_days" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"repeat_cadence_days" integer,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."lesson_learned_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"discipline_id" uuid,
	"reference_number" text NOT NULL,
	"title" text NOT NULL,
	"categorisation" text,
	"issue_category" text NOT NULL,
	"impact" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gps_location" jsonb,
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"client_reference" varchar(255),
	"version" integer DEFAULT 1 NOT NULL,
	"conflict_flag" boolean DEFAULT false NOT NULL,
	"description" text,
	"root_cause" text,
	"correction" text,
	"corrective_action" text,
	"is_repeated" boolean DEFAULT false NOT NULL,
	"repeat_count" integer DEFAULT 0 NOT NULL,
	"repeat_location" text,
	"workflow_state" text DEFAULT 'draft' NOT NULL,
	"creator_id" uuid NOT NULL,
	"approver_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."lesson_learned_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lesson_learned_form_id" uuid NOT NULL,
	"category" text NOT NULL,
	"sequence" integer NOT NULL,
	"object_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."ai_suggestion_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"feature_key" text NOT NULL,
	"prompt" text NOT NULL,
	"response" text,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"duration_ms" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."categorisation_risk_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"impact" text,
	"risk_level" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."disciplines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."distribution_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"cadence" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"business_unit_id" uuid,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"uploaded_by_id" uuid NOT NULL,
	"status" "app2_lessons"."evidence_status" DEFAULT 'uploading' NOT NULL,
	"client_reference" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_template" text NOT NULL,
	"channel" "app2_lessons"."notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."platform_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform_role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"grant" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."platform_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."user_workspace_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_role_id" uuid NOT NULL,
	"business_unit_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"project_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."workspace_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"grant" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app2_lessons"."workspace_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."categorisation_risk_master" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"impact" text,
	"risk_level" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."escalation_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"rule_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"breached_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);

CREATE TABLE "app3_audit"."escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"trigger_key" text NOT NULL,
	"priority" text,
	"sla_working_days" integer NOT NULL,
	"recipient_role" text NOT NULL,
	"repeat_cadence_days" integer,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"business_unit_id" uuid,
	"record_type" text NOT NULL,
	"record_id" uuid NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"uploaded_by_id" uuid NOT NULL,
	"status" "app3_audit"."evidence_status" DEFAULT 'uploading' NOT NULL,
	"client_reference" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"responsible_department" text,
	"classification" text NOT NULL,
	"priority" text,
	"risk_level" text,
	"description" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_template" text NOT NULL,
	"channel" "app3_audit"."notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"read_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."audit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"audit_schedule_id" uuid,
	"project_id" uuid,
	"scope" text,
	"criteria" text,
	"audit_date" date,
	"location" text,
	"team_member_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"workflow_state" text DEFAULT 'draft' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."platform_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform_role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"grant" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."platform_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."audit_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"year" integer NOT NULL,
	"title" text NOT NULL,
	"workflow_state" text DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."user_workspace_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_role_id" uuid NOT NULL,
	"business_unit_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"project_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."workspace_role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"grant" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."workspace_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"audit_plan_id" uuid,
	"project_id" uuid,
	"reference_number" text NOT NULL,
	"opening_minutes" text,
	"closing_minutes" text,
	"opening_meeting_minutes" text,
	"closing_meeting_minutes" text,
	"checklist_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workflow_state" text DEFAULT 'scheduled' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app3_audit"."corrective_action_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"audit_finding_id" uuid NOT NULL,
	"responsible_department" text NOT NULL,
	"owner_id" uuid,
	"root_cause" text,
	"correction" text,
	"corrective_action" text,
	"effectiveness_notes" text,
	"workflow_state" text DEFAULT 'open' NOT NULL,
	"due_date" date,
	"extension_requested_at" timestamp with time zone,
	"extension_approved_at" timestamp with time zone,
	"extension_due_date" date,
	"extension_status" "app3_audit"."car_extension_status" DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."application_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"username" text NOT NULL,
	"project_id" uuid,
	"can_open_qaqc" boolean DEFAULT false NOT NULL,
	"can_open_lessons" boolean DEFAULT false NOT NULL,
	"can_open_audit" boolean DEFAULT false NOT NULL,
	"is_initial_admin_qaqc" boolean DEFAULT false NOT NULL,
	"is_initial_admin_lessons" boolean DEFAULT false NOT NULL,
	"is_initial_admin_audit" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."business_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"head_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."executive_summary_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"app_key" "shared"."executive_app_key" NOT NULL,
	"period_label" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."integration_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_type" text NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"field_mapping_version" integer DEFAULT 1 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."organization_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"working_calendar" jsonb DEFAULT '{"workingDays":["Sunday","Monday","Tuesday","Wednesday","Thursday"],"holidays":[]}'::jsonb NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"allowed_email_domains" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"export_threshold_months" integer DEFAULT 6 NOT NULL,
	"export_threshold_rows" integer DEFAULT 10000 NOT NULL,
	"evidence_limits" jsonb DEFAULT '{"photoMaxMb":8,"photoMaxWidth":1920,"photoMaxHeight":1080,"videoMaxMb":200,"videoMaxMinutes":3,"docMaxMb":25,"lessonPhotoCountMax":5}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_unit_id" uuid,
	"external_id" text,
	"source" text DEFAULT 'local' NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector_id" uuid,
	"job_type" text NOT NULL,
	"schedule" text,
	"last_run_at" timestamp with time zone,
	"duration_ms" integer,
	"outcome" text,
	"error_queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "shared"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"platform_role_id" uuid,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text,
	"auth_source" text DEFAULT 'local' NOT NULL,
	"access_status" text DEFAULT 'active' NOT NULL,
	"last_access_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "app1_qaqc"."ai_suggestion_logs" ADD CONSTRAINT "ai_suggestion_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."ai_suggestion_logs" ADD CONSTRAINT "ai_suggestion_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."audit_log_entries" ADD CONSTRAINT "audit_log_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."categorisation_risk_master" ADD CONSTRAINT "categorisation_risk_master_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."customer_satisfaction_entries" ADD CONSTRAINT "customer_satisfaction_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."customer_satisfaction_entries" ADD CONSTRAINT "customer_satisfaction_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."delegations" ADD CONSTRAINT "delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."delegations" ADD CONSTRAINT "delegations_delegator_id_users_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."delegations" ADD CONSTRAINT "delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."disciplines" ADD CONSTRAINT "disciplines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."distribution_lists" ADD CONSTRAINT "distribution_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."document_governance_log_entries" ADD CONSTRAINT "document_governance_log_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."document_governance_log_entries" ADD CONSTRAINT "document_governance_log_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."document_governance_log_entries" ADD CONSTRAINT "document_governance_log_entries_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "app1_qaqc"."disciplines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."escalation_instances" ADD CONSTRAINT "escalation_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."escalation_instances" ADD CONSTRAINT "escalation_instances_rule_id_escalation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "app1_qaqc"."escalation_rules"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."escalation_rules" ADD CONSTRAINT "escalation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."evidence_files" ADD CONSTRAINT "evidence_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."evidence_files" ADD CONSTRAINT "evidence_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."evidence_files" ADD CONSTRAINT "evidence_files_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "shared"."business_units"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."evidence_files" ADD CONSTRAINT "evidence_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."material_inspection_entries" ADD CONSTRAINT "material_inspection_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."material_inspection_entries" ADD CONSTRAINT "material_inspection_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."notification_templates" ADD CONSTRAINT "notification_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."permissions" ADD CONSTRAINT "permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_platform_role_id_platform_roles_id_fk" FOREIGN KEY ("platform_role_id") REFERENCES "app1_qaqc"."platform_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "app1_qaqc"."permissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."platform_roles" ADD CONSTRAINT "platform_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD CONSTRAINT "qaqc_metric_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."qaqc_metric_entries" ADD CONSTRAINT "qaqc_metric_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."qtbt_entries" ADD CONSTRAINT "qtbt_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."qtbt_entries" ADD CONSTRAINT "qtbt_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."quality_assessment_briefs" ADD CONSTRAINT "quality_assessment_briefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."quality_assessment_briefs" ADD CONSTRAINT "quality_assessment_briefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."quality_assessment_briefs" ADD CONSTRAINT "quality_assessment_briefs_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."quality_assessment_briefs" ADD CONSTRAINT "quality_assessment_briefs_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."report_templates" ADD CONSTRAINT "report_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."target_benchmarks" ADD CONSTRAINT "target_benchmarks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "app1_qaqc"."workspace_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "app1_qaqc"."workspace_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "app1_qaqc"."permissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app1_qaqc"."workspace_roles" ADD CONSTRAINT "workspace_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."delegations" ADD CONSTRAINT "delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."delegations" ADD CONSTRAINT "delegations_delegator_id_users_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."delegations" ADD CONSTRAINT "delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."escalation_instances" ADD CONSTRAINT "escalation_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."escalation_instances" ADD CONSTRAINT "escalation_instances_rule_id_escalation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "app2_lessons"."escalation_rules"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."escalation_rules" ADD CONSTRAINT "escalation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_discipline_id_disciplines_id_fk" FOREIGN KEY ("discipline_id") REFERENCES "app2_lessons"."disciplines"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_forms" ADD CONSTRAINT "lesson_learned_forms_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_photos" ADD CONSTRAINT "lesson_learned_photos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."lesson_learned_photos" ADD CONSTRAINT "lesson_learned_photos_lesson_learned_form_id_lesson_learned_forms_id_fk" FOREIGN KEY ("lesson_learned_form_id") REFERENCES "app2_lessons"."lesson_learned_forms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."ai_suggestion_logs" ADD CONSTRAINT "ai_suggestion_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."ai_suggestion_logs" ADD CONSTRAINT "ai_suggestion_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."audit_log_entries" ADD CONSTRAINT "audit_log_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."categorisation_risk_master" ADD CONSTRAINT "categorisation_risk_master_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."disciplines" ADD CONSTRAINT "disciplines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."distribution_lists" ADD CONSTRAINT "distribution_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."evidence_files" ADD CONSTRAINT "evidence_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."evidence_files" ADD CONSTRAINT "evidence_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."evidence_files" ADD CONSTRAINT "evidence_files_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "shared"."business_units"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."evidence_files" ADD CONSTRAINT "evidence_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."notification_templates" ADD CONSTRAINT "notification_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."permissions" ADD CONSTRAINT "permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_platform_role_id_platform_roles_id_fk" FOREIGN KEY ("platform_role_id") REFERENCES "app2_lessons"."platform_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "app2_lessons"."permissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."platform_roles" ADD CONSTRAINT "platform_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "app2_lessons"."workspace_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "app2_lessons"."workspace_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "app2_lessons"."permissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app2_lessons"."workspace_roles" ADD CONSTRAINT "workspace_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_log_entries" ADD CONSTRAINT "audit_log_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."categorisation_risk_master" ADD CONSTRAINT "categorisation_risk_master_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."delegations" ADD CONSTRAINT "delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."delegations" ADD CONSTRAINT "delegations_delegator_id_users_id_fk" FOREIGN KEY ("delegator_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."delegations" ADD CONSTRAINT "delegations_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."escalation_instances" ADD CONSTRAINT "escalation_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."escalation_instances" ADD CONSTRAINT "escalation_instances_rule_id_escalation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "app3_audit"."escalation_rules"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."escalation_rules" ADD CONSTRAINT "escalation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."evidence_files" ADD CONSTRAINT "evidence_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."evidence_files" ADD CONSTRAINT "evidence_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."evidence_files" ADD CONSTRAINT "evidence_files_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "shared"."business_units"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."evidence_files" ADD CONSTRAINT "evidence_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_findings" ADD CONSTRAINT "audit_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_findings" ADD CONSTRAINT "audit_findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "app3_audit"."audits"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."notification_templates" ADD CONSTRAINT "notification_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."permissions" ADD CONSTRAINT "permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_plans" ADD CONSTRAINT "audit_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_plans" ADD CONSTRAINT "audit_plans_audit_schedule_id_audit_schedules_id_fk" FOREIGN KEY ("audit_schedule_id") REFERENCES "app3_audit"."audit_schedules"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_plans" ADD CONSTRAINT "audit_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_platform_role_id_platform_roles_id_fk" FOREIGN KEY ("platform_role_id") REFERENCES "app3_audit"."platform_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."platform_role_permissions" ADD CONSTRAINT "platform_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "app3_audit"."permissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."platform_roles" ADD CONSTRAINT "platform_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_schedules" ADD CONSTRAINT "audit_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_schedules" ADD CONSTRAINT "audit_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audit_schedules" ADD CONSTRAINT "audit_schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."user_workspace_roles" ADD CONSTRAINT "user_workspace_roles_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "app3_audit"."workspace_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_workspace_role_id_workspace_roles_id_fk" FOREIGN KEY ("workspace_role_id") REFERENCES "app3_audit"."workspace_roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."workspace_role_permissions" ADD CONSTRAINT "workspace_role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "app3_audit"."permissions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."workspace_roles" ADD CONSTRAINT "workspace_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audits" ADD CONSTRAINT "audits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audits" ADD CONSTRAINT "audits_audit_plan_id_audit_plans_id_fk" FOREIGN KEY ("audit_plan_id") REFERENCES "app3_audit"."audit_plans"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."audits" ADD CONSTRAINT "audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."corrective_action_reports" ADD CONSTRAINT "corrective_action_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."corrective_action_reports" ADD CONSTRAINT "corrective_action_reports_audit_finding_id_audit_findings_id_fk" FOREIGN KEY ("audit_finding_id") REFERENCES "app3_audit"."audit_findings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "app3_audit"."corrective_action_reports" ADD CONSTRAINT "corrective_action_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."application_access" ADD CONSTRAINT "application_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."application_access" ADD CONSTRAINT "application_access_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."business_units" ADD CONSTRAINT "business_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."executive_summary_snapshots" ADD CONSTRAINT "executive_summary_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."executive_summary_snapshots" ADD CONSTRAINT "executive_summary_snapshots_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "shared"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."integration_connectors" ADD CONSTRAINT "integration_connectors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."projects" ADD CONSTRAINT "projects_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "shared"."business_units"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."sync_jobs" ADD CONSTRAINT "sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."sync_jobs" ADD CONSTRAINT "sync_jobs_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "shared"."integration_connectors"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "shared"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "shared"."users" ADD CONSTRAINT "users_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "shared"."projects"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "audit_log_org_created_idx" ON "app1_qaqc"."audit_log_entries" USING btree ("organization_id","created_at");
CREATE UNIQUE INDEX "disciplines_org_code_active_idx" ON "app1_qaqc"."disciplines" USING btree ("organization_id","code") WHERE "app1_qaqc"."disciplines"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "evidence_files_org_client_reference_active_idx" ON "app1_qaqc"."evidence_files" USING btree ("organization_id","client_reference") WHERE "app1_qaqc"."evidence_files"."deleted_at" IS NULL AND "app1_qaqc"."evidence_files"."client_reference" IS NOT NULL;
CREATE INDEX "evidence_files_record_idx" ON "app1_qaqc"."evidence_files" USING btree ("record_type","record_id");
CREATE UNIQUE INDEX "notification_templates_org_key_active_idx" ON "app1_qaqc"."notification_templates" USING btree ("organization_id","key") WHERE "app1_qaqc"."notification_templates"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "permissions_org_key_active_idx" ON "app1_qaqc"."permissions" USING btree ("organization_id","key") WHERE "app1_qaqc"."permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_role_permission_active_idx" ON "app1_qaqc"."platform_role_permissions" USING btree ("platform_role_id","permission_id") WHERE "app1_qaqc"."platform_role_permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_roles_org_name_active_idx" ON "app1_qaqc"."platform_roles" USING btree ("organization_id","name") WHERE "app1_qaqc"."platform_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "qaqc_metric_project_period_category_active_idx" ON "app1_qaqc"."qaqc_metric_entries" USING btree ("project_id","reporting_period","category") WHERE "app1_qaqc"."qaqc_metric_entries"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "target_benchmarks_org_metric_active_idx" ON "app1_qaqc"."target_benchmarks" USING btree ("organization_id","metric_key") WHERE "app1_qaqc"."target_benchmarks"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "user_workspace_role_active_idx" ON "app1_qaqc"."user_workspace_roles" USING btree ("user_id","workspace_role_id") WHERE "app1_qaqc"."user_workspace_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspace_role_permission_active_idx" ON "app1_qaqc"."workspace_role_permissions" USING btree ("workspace_role_id","permission_id") WHERE "app1_qaqc"."workspace_role_permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspace_roles_org_name_active_idx" ON "app1_qaqc"."workspace_roles" USING btree ("organization_id","name") WHERE "app1_qaqc"."workspace_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "lesson_reference_active_idx" ON "app2_lessons"."lesson_learned_forms" USING btree ("organization_id","reference_number") WHERE "app2_lessons"."lesson_learned_forms"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "lesson_client_reference_active_idx" ON "app2_lessons"."lesson_learned_forms" USING btree ("organization_id","client_reference") WHERE "app2_lessons"."lesson_learned_forms"."deleted_at" IS NULL AND "app2_lessons"."lesson_learned_forms"."client_reference" IS NOT NULL;
CREATE UNIQUE INDEX "lesson_photo_sequence_active_idx" ON "app2_lessons"."lesson_learned_photos" USING btree ("lesson_learned_form_id","category","sequence") WHERE "app2_lessons"."lesson_learned_photos"."deleted_at" IS NULL;
CREATE INDEX "audit_log_org_created_idx" ON "app2_lessons"."audit_log_entries" USING btree ("organization_id","created_at");
CREATE UNIQUE INDEX "disciplines_org_code_active_idx" ON "app2_lessons"."disciplines" USING btree ("organization_id","code") WHERE "app2_lessons"."disciplines"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "evidence_files_org_client_reference_active_idx" ON "app2_lessons"."evidence_files" USING btree ("organization_id","client_reference") WHERE "app2_lessons"."evidence_files"."deleted_at" IS NULL AND "app2_lessons"."evidence_files"."client_reference" IS NOT NULL;
CREATE INDEX "evidence_files_record_idx" ON "app2_lessons"."evidence_files" USING btree ("record_type","record_id");
CREATE UNIQUE INDEX "notification_templates_org_key_active_idx" ON "app2_lessons"."notification_templates" USING btree ("organization_id","key") WHERE "app2_lessons"."notification_templates"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "permissions_org_key_active_idx" ON "app2_lessons"."permissions" USING btree ("organization_id","key") WHERE "app2_lessons"."permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_role_permission_active_idx" ON "app2_lessons"."platform_role_permissions" USING btree ("platform_role_id","permission_id") WHERE "app2_lessons"."platform_role_permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_roles_org_name_active_idx" ON "app2_lessons"."platform_roles" USING btree ("organization_id","name") WHERE "app2_lessons"."platform_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "user_workspace_role_active_idx" ON "app2_lessons"."user_workspace_roles" USING btree ("user_id","workspace_role_id") WHERE "app2_lessons"."user_workspace_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspace_role_permission_active_idx" ON "app2_lessons"."workspace_role_permissions" USING btree ("workspace_role_id","permission_id") WHERE "app2_lessons"."workspace_role_permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspace_roles_org_name_active_idx" ON "app2_lessons"."workspace_roles" USING btree ("organization_id","name") WHERE "app2_lessons"."workspace_roles"."deleted_at" IS NULL;
CREATE INDEX "audit_log_org_created_idx" ON "app3_audit"."audit_log_entries" USING btree ("organization_id","created_at");
CREATE UNIQUE INDEX "evidence_files_org_client_reference_active_idx" ON "app3_audit"."evidence_files" USING btree ("organization_id","client_reference") WHERE "app3_audit"."evidence_files"."deleted_at" IS NULL AND "app3_audit"."evidence_files"."client_reference" IS NOT NULL;
CREATE INDEX "evidence_files_record_idx" ON "app3_audit"."evidence_files" USING btree ("record_type","record_id");
CREATE UNIQUE INDEX "notification_templates_org_key_active_idx" ON "app3_audit"."notification_templates" USING btree ("organization_id","key") WHERE "app3_audit"."notification_templates"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "permissions_org_key_active_idx" ON "app3_audit"."permissions" USING btree ("organization_id","key") WHERE "app3_audit"."permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_role_permission_active_idx" ON "app3_audit"."platform_role_permissions" USING btree ("platform_role_id","permission_id") WHERE "app3_audit"."platform_role_permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "platform_roles_org_name_active_idx" ON "app3_audit"."platform_roles" USING btree ("organization_id","name") WHERE "app3_audit"."platform_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "user_workspace_role_active_idx" ON "app3_audit"."user_workspace_roles" USING btree ("user_id","workspace_role_id") WHERE "app3_audit"."user_workspace_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspace_role_permission_active_idx" ON "app3_audit"."workspace_role_permissions" USING btree ("workspace_role_id","permission_id") WHERE "app3_audit"."workspace_role_permissions"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "workspace_roles_org_name_active_idx" ON "app3_audit"."workspace_roles" USING btree ("organization_id","name") WHERE "app3_audit"."workspace_roles"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "audit_reference_active_idx" ON "app3_audit"."audits" USING btree ("organization_id","reference_number") WHERE "app3_audit"."audits"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "application_access_org_username_project_active_idx" ON "shared"."application_access" USING btree ("organization_id","username","project_id") WHERE "shared"."application_access"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "business_units_org_code_active_idx" ON "shared"."business_units" USING btree ("organization_id","code") WHERE "shared"."business_units"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "executive_summary_org_app_period_active_idx" ON "shared"."executive_summary_snapshots" USING btree ("organization_id","app_key","period_label") WHERE "shared"."executive_summary_snapshots"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "organization_settings_org_active_idx" ON "shared"."organization_settings" USING btree ("organization_id") WHERE "shared"."organization_settings"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "organizations_code_active_idx" ON "shared"."organizations" USING btree ("code") WHERE "shared"."organizations"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "projects_org_code_active_idx" ON "shared"."projects" USING btree ("organization_id","code") WHERE "shared"."projects"."deleted_at" IS NULL;
CREATE INDEX "projects_business_unit_idx" ON "shared"."projects" USING btree ("business_unit_id");
CREATE UNIQUE INDEX "users_org_email_active_idx" ON "shared"."users" USING btree ("organization_id","email") WHERE "shared"."users"."deleted_at" IS NULL;
CREATE UNIQUE INDEX "users_org_username_active_idx" ON "shared"."users" USING btree ("organization_id","username") WHERE "shared"."users"."deleted_at" IS NULL;
CREATE INDEX "users_project_idx" ON "shared"."users" USING btree ("project_id");
