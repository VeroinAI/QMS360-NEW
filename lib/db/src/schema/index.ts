import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const auditColumns = {
  status: text("status").notNull().default("active"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  timezone: text("timezone").notNull().default("Asia/Riyadh"),
  locale: text("locale").notNull().default("en"),
  branding: jsonb("branding").$type<Record<string, string>>().notNull().default({}),
  ...auditColumns,
}, (table) => [
  uniqueIndex("organizations_code_active_idx").on(table.code).where(sql`${table.deletedAt} IS NULL`),
]);

export const businessUnits = pgTable("business_units", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  headName: text("head_name"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("business_units_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`),
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  businessUnitId: uuid("business_unit_id").references(() => businessUnits.id),
  externalId: text("external_id"),
  source: text("source").notNull().default("local"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  location: text("location"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("projects_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`),
  index("projects_business_unit_idx").on(table.businessUnitId),
]);

export const platformRoles = pgTable("platform_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  ...auditColumns,
}, (table) => [
  uniqueIndex("platform_roles_org_name_active_idx").on(table.organizationId, table.name).where(sql`${table.deletedAt} IS NULL`),
]);

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  category: text("category").notNull(),
}, (table) => [uniqueIndex("permissions_key_idx").on(table.key)]);

export const platformRolePermissions = pgTable("platform_role_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  platformRoleId: uuid("platform_role_id").notNull().references(() => platformRoles.id),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id),
  grant: text("grant").notNull().default("full"),
}, (table) => [uniqueIndex("platform_role_permission_idx").on(table.platformRoleId, table.permissionId)]);

export const workspaceRoles = pgTable("workspace_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appKey: text("app_key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  ...auditColumns,
}, (table) => [
  uniqueIndex("workspace_roles_org_app_name_active_idx").on(table.organizationId, table.appKey, table.name).where(sql`${table.deletedAt} IS NULL`),
]);

export const workspaceRolePermissions = pgTable("workspace_role_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceRoleId: uuid("workspace_role_id").notNull().references(() => workspaceRoles.id),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id),
  grant: text("grant").notNull().default("full"),
}, (table) => [uniqueIndex("workspace_role_permission_idx").on(table.workspaceRoleId, table.permissionId)]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").references(() => projects.id),
  platformRoleId: uuid("platform_role_id").references(() => platformRoles.id),
  email: text("email").notNull(),
  username: text("username").notNull(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash"),
  authSource: text("auth_source").notNull().default("local"),
  accessStatus: text("access_status").notNull().default("active"),
  lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
  ...auditColumns,
}, (table) => [
  uniqueIndex("users_org_email_active_idx").on(table.organizationId, table.email).where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex("users_org_username_active_idx").on(table.organizationId, table.username).where(sql`${table.deletedAt} IS NULL`),
  index("users_project_idx").on(table.projectId),
]);

export const userWorkspaceRoles = pgTable("user_workspace_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  workspaceRoleId: uuid("workspace_role_id").notNull().references(() => workspaceRoles.id),
  businessUnitIds: uuid("business_unit_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  projectIds: uuid("project_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  ...auditColumns,
}, (table) => [uniqueIndex("user_workspace_role_idx").on(table.userId, table.workspaceRoleId).where(sql`${table.deletedAt} IS NULL`)]);

export const delegations = pgTable("delegations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  delegatorId: uuid("delegator_id").notNull().references(() => users.id),
  delegateId: uuid("delegate_id").notNull().references(() => users.id),
  appKey: text("app_key"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const disciplines = pgTable("disciplines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  ...auditColumns,
}, (table) => [uniqueIndex("disciplines_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`)]);

export const categorisationRiskMaster = pgTable("categorisation_risk_master", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  category: text("category").notNull(),
  impact: text("impact"),
  riskLevel: text("risk_level"),
  ...auditColumns,
});

export const targetBenchmarks = pgTable("target_benchmarks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appKey: text("app_key").notNull(),
  metricKey: text("metric_key").notNull(),
  targetValue: numeric("target_value", { precision: 10, scale: 2 }).notNull(),
  period: text("period").notNull().default("monthly"),
  ...auditColumns,
}, (table) => [uniqueIndex("target_benchmarks_org_app_metric_active_idx").on(table.organizationId, table.appKey, table.metricKey).where(sql`${table.deletedAt} IS NULL`)]);

export const distributionLists = pgTable("distribution_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  appKey: text("app_key"),
  memberIds: uuid("member_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  cadence: text("cadence"),
  ...auditColumns,
});

export const reportTemplates = pgTable("report_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appKey: text("app_key").notNull(),
  name: text("name").notNull(),
  template: jsonb("template").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const qaqcMetricEntries = pgTable("qaqc_metric_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  category: text("category").notNull(),
  issuedCount: integer("issued_count").notNull().default(0),
  closedCount: integer("closed_count").notNull().default(0),
  ageing0To15: integer("ageing_0_to_15").notNull().default(0),
  ageing15To45: integer("ageing_15_to_45").notNull().default(0),
  ageingOver45: integer("ageing_over_45").notNull().default(0),
  ...auditColumns,
}, (table) => [uniqueIndex("qaqc_metric_project_period_category_active_idx").on(table.projectId, table.reportingPeriod, table.category).where(sql`${table.deletedAt} IS NULL`)]);

export const materialInspectionEntries = pgTable("material_inspection_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  mirnTotal: integer("mirn_total").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  onHoldCount: integer("on_hold_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  hazardousCount: integer("hazardous_count").notNull().default(0),
  handleWithCareCount: integer("handle_with_care_count").notNull().default(0),
  osdCount: integer("osd_count").notNull().default(0),
  ...auditColumns,
});

export const qtbtEntries = pgTable("qtbt_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  talkCount: integer("talk_count").notNull().default(0),
  attendanceCount: integer("attendance_count").notNull().default(0),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  ...auditColumns,
});

export const customerSatisfactionEntries = pgTable("customer_satisfaction_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  dimensions: jsonb("dimensions").$type<Record<string, number>>().notNull().default({}),
  outcomes: jsonb("outcomes").$type<Record<string, string>>().notNull().default({}),
  feedback: text("feedback"),
  ...auditColumns,
});

export const documentGovernanceLogEntries = pgTable("document_governance_log_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  disciplineId: uuid("discipline_id").references(() => disciplines.id),
  entity: text("entity").notNull(),
  statusValue: text("status_value").notNull(),
  count: integer("count").notNull().default(0),
  averageReviewDays: numeric("average_review_days", { precision: 10, scale: 2 }).notNull().default("0"),
  pendingDays: integer("pending_days").notNull().default(0),
  ...auditColumns,
});

export const qualityAssessmentBriefs = pgTable("quality_assessment_briefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  narrative: text("narrative"),
  aiDraft: text("ai_draft"),
  aiReviewState: text("ai_review_state"),
  workflowState: text("workflow_state").notNull().default("draft"),
  submittedById: uuid("submitted_by_id").references(() => users.id),
  approvedById: uuid("approved_by_id").references(() => users.id),
  ...auditColumns,
});

export const lessonLearnedForms = pgTable("lesson_learned_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  disciplineId: uuid("discipline_id").references(() => disciplines.id),
  referenceNumber: text("reference_number").notNull(),
  title: text("title").notNull(),
  categorisation: text("categorisation"),
  issueCategory: text("issue_category").notNull(),
  impact: text("impact").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  gpsLocation: jsonb("gps_location").$type<{ lat: number; lng: number }>(),
  description: text("description"),
  rootCause: text("root_cause"),
  correction: text("correction"),
  correctiveAction: text("corrective_action"),
  isRepeated: boolean("is_repeated").notNull().default(false),
  repeatCount: integer("repeat_count").notNull().default(0),
  repeatLocation: text("repeat_location"),
  workflowState: text("workflow_state").notNull().default("draft"),
  creatorId: uuid("creator_id").notNull().references(() => users.id),
  approverId: uuid("approver_id").references(() => users.id),
  ...auditColumns,
}, (table) => [uniqueIndex("lesson_reference_active_idx").on(table.organizationId, table.referenceNumber).where(sql`${table.deletedAt} IS NULL`)]);

export const lessonLearnedPhotos = pgTable("lesson_learned_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  lessonLearnedFormId: uuid("lesson_learned_form_id").notNull().references(() => lessonLearnedForms.id),
  category: text("category").notNull(),
  sequence: integer("sequence").notNull(),
  objectPath: text("object_path").notNull(),
  mimeType: text("mime_type").notNull(),
  ...auditColumns,
}, (table) => [uniqueIndex("lesson_photo_sequence_active_idx").on(table.lessonLearnedFormId, table.category, table.sequence).where(sql`${table.deletedAt} IS NULL`)]);

export const auditSchedules = pgTable("audit_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").references(() => projects.id),
  year: integer("year").notNull(),
  title: text("title").notNull(),
  workflowState: text("workflow_state").notNull().default("draft"),
  ownerId: uuid("owner_id").references(() => users.id),
  ...auditColumns,
});

export const auditPlans = pgTable("audit_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  auditScheduleId: uuid("audit_schedule_id").references(() => auditSchedules.id),
  projectId: uuid("project_id").references(() => projects.id),
  scope: text("scope"),
  criteria: text("criteria"),
  auditDate: date("audit_date", { mode: "string" }),
  location: text("location"),
  teamMemberIds: uuid("team_member_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  workflowState: text("workflow_state").notNull().default("draft"),
  ...auditColumns,
});

export const audits = pgTable("audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  auditPlanId: uuid("audit_plan_id").references(() => auditPlans.id),
  projectId: uuid("project_id").references(() => projects.id),
  referenceNumber: text("reference_number").notNull(),
  openingMinutes: text("opening_minutes"),
  closingMinutes: text("closing_minutes"),
  workflowState: text("workflow_state").notNull().default("scheduled"),
  ...auditColumns,
}, (table) => [uniqueIndex("audit_reference_active_idx").on(table.organizationId, table.referenceNumber).where(sql`${table.deletedAt} IS NULL`)]);

export const auditFindings = pgTable("audit_findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  auditId: uuid("audit_id").notNull().references(() => audits.id),
  responsibleDepartment: text("responsible_department"),
  classification: text("classification").notNull(),
  priority: text("priority"),
  riskLevel: text("risk_level"),
  description: text("description"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const correctiveActionReports = pgTable("corrective_action_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  auditFindingId: uuid("audit_finding_id").notNull().references(() => auditFindings.id),
  responsibleDepartment: text("responsible_department").notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  rootCause: text("root_cause"),
  correction: text("correction"),
  correctiveAction: text("corrective_action"),
  effectivenessNotes: text("effectiveness_notes"),
  workflowState: text("workflow_state").notNull().default("open"),
  dueDate: date("due_date", { mode: "string" }),
  ...auditColumns,
});

export const escalationRules = pgTable("escalation_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appKey: text("app_key").notNull(),
  triggerKey: text("trigger_key").notNull(),
  priority: text("priority"),
  slaWorkingDays: integer("sla_working_days").notNull(),
  recipientRole: text("recipient_role").notNull(),
  repeatCadenceDays: integer("repeat_cadence_days"),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const escalationInstances = pgTable("escalation_instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appKey: text("app_key").notNull(),
  recordType: text("record_type").notNull(),
  recordId: uuid("record_id").notNull(),
  ruleId: uuid("rule_id").references(() => escalationRules.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...auditColumns,
  status: text("status").notNull().default("open"),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  recipientId: uuid("recipient_id").notNull().references(() => users.id),
  appKey: text("app_key"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  channel: text("channel").notNull().default("in_app"),
  readAt: timestamp("read_at", { withTimezone: true }),
  ...auditColumns,
});

export const auditLogEntries = pgTable("audit_log_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_log_org_created_idx").on(table.organizationId, table.createdAt)]);

export const aiSuggestionLogs = pgTable("ai_suggestion_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  actorId: uuid("actor_id").references(() => users.id),
  appKey: text("app_key").notNull(),
  featureKey: text("feature_key").notNull(),
  prompt: text("prompt").notNull(),
  response: text("response"),
  reviewState: text("review_state").notNull().default("pending"),
  failureReason: text("failure_reason"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrationConnectors = pgTable("integration_connectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  connectorType: text("connector_type").notNull(),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  fieldMappingVersion: integer("field_mapping_version").notNull().default(1),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const syncJobs = pgTable("sync_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  connectorId: uuid("connector_id").references(() => integrationConnectors.id),
  jobType: text("job_type").notNull(),
  schedule: text("schedule"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  outcome: text("outcome"),
  errorQueue: jsonb("error_queue").$type<Array<Record<string, unknown>>>().notNull().default([]),
  ...auditColumns,
});

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;