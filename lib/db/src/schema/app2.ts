import { boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, projects, users } from "./shared";
import { createAppAdministration } from "./app-common";

export const app2LessonsSchema = pgSchema("app2_lessons");
const admin = createAppAdministration(app2LessonsSchema);
export const lessonsPlatformRoles = admin.platformRoles;
export const lessonsPermissions = admin.permissions;
export const lessonsPlatformRolePermissions = admin.platformRolePermissions;
export const lessonsWorkspaceRoles = admin.workspaceRoles;
export const lessonsWorkspaceRolePermissions = admin.workspaceRolePermissions;
export const lessonsUserWorkspaceRoles = admin.userWorkspaceRoles;
export const lessonDelegations = admin.delegations;
export const lessonEscalationRules = admin.escalationRules;
export const lessonEscalationInstances = admin.escalationInstances;
export const lessonNotifications = admin.notifications;
export const lessonsAuditLogEntries = admin.auditLogEntries;
export const lessonsNotificationTemplates = admin.notificationTemplates;
export const lessonsEvidenceFiles = admin.evidenceFiles;
const auditColumns = admin.auditColumns;

export const lessonsAiSuggestionLogs = app2LessonsSchema.table("ai_suggestion_logs", {
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

export const lessonsDisciplines = app2LessonsSchema.table("disciplines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  ...auditColumns,
}, (table) => [uniqueIndex("disciplines_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`)]);

export const lessonsCategorisationRiskMaster = app2LessonsSchema.table("categorisation_risk_master", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  category: text("category").notNull(),
  impact: text("impact"),
  riskLevel: text("risk_level"),
  ...auditColumns,
});

export const lessonsDistributionLists = app2LessonsSchema.table("distribution_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  memberIds: uuid("member_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
  cadence: text("cadence"),
  ...auditColumns,
});

export const lessonLearnedForms = app2LessonsSchema.table("lesson_learned_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  disciplineId: uuid("discipline_id").references(() => lessonsDisciplines.id),
  referenceNumber: text("reference_number").notNull(),
  title: text("title").notNull(),
  categorisation: text("categorisation"),
  issueCategory: text("issue_category").notNull(),
  impact: text("impact").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  gpsLocation: jsonb("gps_location").$type<{ lat: number; lng: number }>(),
  gpsLat: numeric("gps_lat", { precision: 10, scale: 7 }),
  gpsLng: numeric("gps_lng", { precision: 10, scale: 7 }),
  clientReference: varchar("client_reference", { length: 255 }),
  version: integer("version").notNull().default(1),
  conflictFlag: boolean("conflict_flag").notNull().default(false),
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
}, (table) => [
  uniqueIndex("lesson_reference_active_idx").on(table.organizationId, table.referenceNumber).where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex("lesson_client_reference_active_idx").on(table.organizationId, table.clientReference).where(sql`${table.deletedAt} IS NULL AND ${table.clientReference} IS NOT NULL`),
]);

export const lessonLearnedPhotos = app2LessonsSchema.table("lesson_learned_photos", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  lessonLearnedFormId: uuid("lesson_learned_form_id").notNull().references(() => lessonLearnedForms.id),
  category: text("category").notNull(),
  sequence: integer("sequence").notNull(),
  objectPath: text("object_path").notNull(),
  mimeType: text("mime_type").notNull(),
  ...auditColumns,
}, (table) => [uniqueIndex("lesson_photo_sequence_active_idx").on(table.lessonLearnedFormId, table.category, table.sequence).where(sql`${table.deletedAt} IS NULL`)]);