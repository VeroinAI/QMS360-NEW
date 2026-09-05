import { boolean, date, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, projects, users } from "./shared";
import { createAppAdministration } from "./app-common";

export const app3AuditSchema = pgSchema("app3_audit");
export const carExtensionStatus = app3AuditSchema.enum("car_extension_status", ["none", "requested", "approved", "rejected"]);
const admin = createAppAdministration(app3AuditSchema);
export const auditEvidenceStatus = admin.evidenceStatus;
export const auditNotificationChannel = admin.notificationChannel;
export const auditPlatformRoles = admin.platformRoles;
export const auditPermissions = admin.permissions;
export const auditPlatformRolePermissions = admin.platformRolePermissions;
export const auditWorkspaceRoles = admin.workspaceRoles;
export const auditWorkspaceRolePermissions = admin.workspaceRolePermissions;
export const auditUserWorkspaceRoles = admin.userWorkspaceRoles;
export const auditDelegations = admin.delegations;
export const auditEscalationRules = admin.escalationRules;
export const auditEscalationInstances = admin.escalationInstances;
export const auditNotifications = admin.notifications;
export const auditAuditLogEntries = admin.auditLogEntries;
export const auditNotificationTemplates = admin.notificationTemplates;
export const auditEvidenceFiles = admin.evidenceFiles;
const auditColumns = admin.auditColumns;

export const auditCategorisationRiskMaster = app3AuditSchema.table("categorisation_risk_master", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  category: text("category").notNull(),
  impact: text("impact"),
  riskLevel: text("risk_level"),
  ...auditColumns,
});

export const auditSchedules = app3AuditSchema.table("audit_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").references(() => projects.id),
  year: integer("year").notNull(),
  title: text("title").notNull(),
  workflowState: text("workflow_state").notNull().default("draft"),
  ownerId: uuid("owner_id").references(() => users.id),
  ...auditColumns,
});

export const auditPlans = app3AuditSchema.table("audit_plans", {
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

export const audits = app3AuditSchema.table("audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  auditPlanId: uuid("audit_plan_id").references(() => auditPlans.id),
  projectId: uuid("project_id").references(() => projects.id),
  referenceNumber: text("reference_number").notNull(),
  referenceGenerated: boolean("reference_generated").notNull().default(false),
  openingMinutes: text("opening_minutes"),
  closingMinutes: text("closing_minutes"),
  openingMeetingMinutes: text("opening_meeting_minutes"),
  closingMeetingMinutes: text("closing_meeting_minutes"),
  checklistState: jsonb("checklist_state").$type<Record<string, unknown>>().notNull().default({}),
  workflowState: text("workflow_state").notNull().default("scheduled"),
  ...auditColumns,
}, (table) => [uniqueIndex("audit_reference_active_idx").on(table.organizationId, table.referenceNumber).where(sql`${table.deletedAt} IS NULL`)]);

export const auditFindings = app3AuditSchema.table("audit_findings", {
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

export const correctiveActionReports = app3AuditSchema.table("corrective_action_reports", {
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
  extensionRequestedAt: timestamp("extension_requested_at", { withTimezone: true }),
  extensionApprovedAt: timestamp("extension_approved_at", { withTimezone: true }),
  extensionDueDate: date("extension_due_date", { mode: "string" }),
  extensionStatus: carExtensionStatus("extension_status").notNull().default("none"),
  ...auditColumns,
});