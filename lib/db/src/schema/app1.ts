import { boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, projects, users } from "./shared";
import { createAppAdministration } from "./app-common";

export const app1QaqcSchema = pgSchema("app1_qaqc");
const admin = createAppAdministration(app1QaqcSchema);
export const evidenceStatus = admin.evidenceStatus;
export const notificationChannel = admin.notificationChannel;
export const {
  platformRoles, permissions, platformRolePermissions, workspaceRoles,
  workspaceRolePermissions, userWorkspaceRoles, delegations, escalationRules,
  escalationInstances, notifications, auditLogEntries, notificationTemplates,
  evidenceFiles,
} = admin;
const auditColumns = admin.auditColumns;

export const aiSuggestionLogs = app1QaqcSchema.table("ai_suggestion_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  actorId: uuid("actor_id").references(() => users.id),
  featureKey: text("feature_key").notNull(),
  prompt: text("prompt").notNull(),
  response: text("response"),
  reviewState: text("review_state").notNull().default("pending"),
  failureReason: text("failure_reason"),
  durationMs: integer("duration_ms"),
  ...auditColumns,
});

export const disciplines = app1QaqcSchema.table("disciplines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  ...auditColumns,
}, (table) => [uniqueIndex("disciplines_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`)]);

export const categorisationRiskMaster = app1QaqcSchema.table("categorisation_risk_master", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  category: text("category").notNull(),
  impact: text("impact"),
  riskLevel: text("risk_level"),
  ...auditColumns,
});

export const targetBenchmarks = app1QaqcSchema.table("target_benchmarks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  metricKey: text("metric_key").notNull(),
  targetValue: numeric("target_value", { precision: 10, scale: 2 }).notNull(),
  period: text("period").notNull().default("monthly"),
  ...auditColumns,
}, (table) => [uniqueIndex("target_benchmarks_org_metric_active_idx").on(table.organizationId, table.metricKey).where(sql`${table.deletedAt} IS NULL`)]);

export const distributionLists = app1QaqcSchema.table("distribution_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  memberIds: uuid("member_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  cadence: text("cadence"),
  ...auditColumns,
});

export const reportTemplates = app1QaqcSchema.table("report_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  template: jsonb("template").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const qaqcMetricEntries = app1QaqcSchema.table("qaqc_metric_entries", {
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
  approverId: uuid("approver_id").references(() => users.id),
  submittedById: uuid("submitted_by_id").references(() => users.id),
  referenceNumber: text("reference_number"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("qaqc_metric_project_period_category_active_idx").on(table.projectId, table.reportingPeriod, table.category).where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex("qaqc_metric_reference_active_idx").on(table.organizationId, table.referenceNumber).where(sql`${table.deletedAt} IS NULL AND ${table.referenceNumber} IS NOT NULL`),
]);

export const materialInspectionEntries = app1QaqcSchema.table("material_inspection_entries", {
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

export const qtbtEntries = app1QaqcSchema.table("qtbt_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  talkCount: integer("talk_count").notNull().default(0),
  attendanceCount: integer("attendance_count").notNull().default(0),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  ...auditColumns,
});

export const customerSatisfactionEntries = app1QaqcSchema.table("customer_satisfaction_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  reportingPeriod: date("reporting_period", { mode: "string" }).notNull(),
  dimensions: jsonb("dimensions").$type<Record<string, number>>().notNull().default({}),
  outcomes: jsonb("outcomes").$type<Record<string, string>>().notNull().default({}),
  feedback: text("feedback"),
  ...auditColumns,
});

export const documentGovernanceLogEntries = app1QaqcSchema.table("document_governance_log_entries", {
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

export const qualityAssessmentBriefs = app1QaqcSchema.table("quality_assessment_briefs", {
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
  approverId: uuid("approver_id").references(() => users.id),
  ...auditColumns,
});