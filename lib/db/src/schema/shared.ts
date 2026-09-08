import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sharedSchema = pgSchema("shared");
export const executiveAppKey = sharedSchema.enum("executive_app_key", ["qaqc", "lessons", "audit"]);

export const fieldAccessLevel = sharedSchema.enum("field_access_level", ["editable", "read_only"]);
const auditColumns = {
  status: text("status").notNull().default("active"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizations = sharedSchema.table("organizations", {
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

export const masterDataGroups = sharedSchema.table("master_data_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  appScope: text("app_scope").notNull().default("global"),
  isSystem: boolean("is_system").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  ...auditColumns,
}, (table) => [
  uniqueIndex("master_data_groups_org_code_active_idx")
    .on(table.organizationId, table.code)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const masterDataValues = sharedSchema.table("master_data_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  groupId: uuid("group_id").notNull().references(() => masterDataGroups.id, { onDelete: "cascade" }),
  value: text("value").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
}, (table) => [
  uniqueIndex("master_data_values_group_value_active_idx")
    .on(table.groupId, table.value)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const businessUnits = sharedSchema.table("business_units", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  headName: text("head_name"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("business_units_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`),
]);

export const projects = sharedSchema.table("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  businessUnitId: uuid("business_unit_id").references(() => businessUnits.id),
  externalId: text("external_id"),
  source: text("source").notNull().default("local"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  location: text("location"),
  // Extra columns arriving from source-system pulls or Excel imports whose
  // template goes beyond the core fields (template field key → value).
  customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
}, (table) => [
  uniqueIndex("projects_org_code_active_idx").on(table.organizationId, table.code).where(sql`${table.deletedAt} IS NULL`),
  index("projects_business_unit_idx").on(table.businessUnitId),
]);

export const users = sharedSchema.table("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  projectId: uuid("project_id").references(() => projects.id),
  // Retained for backwards compatibility. Per-application role assignments are authoritative.
  platformRoleId: uuid("platform_role_id"),
  email: text("email").notNull(),
  username: text("username").notNull(),
  fullName: text("full_name").notNull(),
  designation: text("designation"),
  // Object-storage key of the user's signature image (used on approval records).
  signaturePath: text("signature_path"),
  passwordHash: text("password_hash"),
  authSource: text("auth_source").notNull().default("local"),
  accessStatus: text("access_status").notNull().default("active"),
  lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
  // Same extension point as projects.custom_fields for synced/imported users.
  customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
}, (table) => [
  uniqueIndex("users_org_email_active_idx").on(table.organizationId, table.email).where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex("users_org_username_active_idx").on(table.organizationId, table.username).where(sql`${table.deletedAt} IS NULL`),
  index("users_project_idx").on(table.projectId),
]);

export const applicationAccess = sharedSchema.table("application_access", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  username: text("username").notNull(),
  projectId: uuid("project_id").references(() => projects.id),
  canOpenQaqc: boolean("can_open_qaqc").notNull().default(false),
  canOpenLessons: boolean("can_open_lessons").notNull().default(false),
  canOpenAudit: boolean("can_open_audit").notNull().default(false),
  isInitialAdminQaqc: boolean("is_initial_admin_qaqc").notNull().default(false),
  isInitialAdminLessons: boolean("is_initial_admin_lessons").notNull().default(false),
  isInitialAdminAudit: boolean("is_initial_admin_audit").notNull().default(false),
  ...auditColumns,
}, (table) => [
  uniqueIndex("application_access_org_username_project_active_idx")
    .on(table.organizationId, table.username, table.projectId)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const organizationSettings = sharedSchema.table("organization_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  branding: jsonb("branding").$type<Record<string, unknown>>().notNull().default({}),
  workingCalendar: jsonb("working_calendar").$type<{ workingDays: string[]; holidays: string[] }>().notNull().default({ workingDays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"], holidays: [] }),
  locale: text("locale").notNull().default("en"),
  timezone: text("timezone").notNull().default("Asia/Riyadh"),
  allowedEmailDomains: text("allowed_email_domains").array().notNull().default(sql`ARRAY[]::text[]`),
  exportThresholdMonths: integer("export_threshold_months").notNull().default(6),
  exportThresholdRows: integer("export_threshold_rows").notNull().default(10000),
  evidenceLimits: jsonb("evidence_limits").$type<{
    photoMaxMb: number;
    photoMaxWidth: number;
    photoMaxHeight: number;
    videoMaxMb: number;
    videoMaxMinutes: number;
    docMaxMb: number;
    lessonPhotoCountMax: number;
  }>().notNull().default({
    photoMaxMb: 8,
    photoMaxWidth: 1920,
    photoMaxHeight: 1080,
    videoMaxMb: 200,
    videoMaxMinutes: 3,
    docMaxMb: 25,
    lessonPhotoCountMax: 5,
  }),
  documentNumbering: jsonb("document_numbering").$type<Record<string, {
    prefix: string;
    suffix: string;
    separator: string;
    position: "after_prefix" | "after_suffix" | "before_prefix";
    padding: number;
    startingNumber: number;
    nextNumber: number;
  }>>().notNull().default({}),
  ...auditColumns,
}, (table) => [
  uniqueIndex("organization_settings_org_active_idx").on(table.organizationId).where(sql`${table.deletedAt} IS NULL`),
]);

export const integrationConnectors = sharedSchema.table("integration_connectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  connectorType: text("connector_type").notNull(),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  fieldMappingVersion: integer("field_mapping_version").notNull().default(1),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  ...auditColumns,
});

export const syncJobs = sharedSchema.table("sync_jobs", {
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

export const connectorFieldMappings = sharedSchema.table("connector_field_mappings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  connectorId: uuid("connector_id").notNull().references(() => integrationConnectors.id),
  entity: text("entity").notNull(),
  sourceField: text("source_field").notNull(),
  targetField: text("target_field").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  ...auditColumns,
}, (table) => [
  index("connector_field_mappings_connector_idx").on(table.connectorId),
]);

// Excel import templates for the Integration Cockpit file-drop fallback. Each
// template declares the spreadsheet columns an admin expects; `field` is a core
// entity key (e.g. code, email) or `custom.<key>` routed into custom_fields.
export const importTemplates = sharedSchema.table("import_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  entity: text("entity").notNull(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  columns: jsonb("columns").$type<Array<{ header: string; field: string; required: boolean }>>().notNull().default([]),
  ...auditColumns,
}, (table) => [
  index("import_templates_org_entity_idx").on(table.organizationId, table.entity),
]);

export const feedbackEntries = sharedSchema.table("feedback_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  appKey: text("app_key"),
  module: text("module"),
  pagePath: text("page_path"),
  category: text("category").notNull().default("issue"),
  message: text("message").notNull(),
  triage: jsonb("triage").$type<{ verdict: string; summary: string; guidance: string | null; resolutionSuggestion: string | null }>(),
  resolution: text("resolution").notNull().default("open"),
  resolutionResponse: text("resolution_response"),
  ...auditColumns,
});

export const executiveSummarySnapshots = sharedSchema.table("executive_summary_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  appKey: executiveAppKey("app_key").notNull(),
  periodLabel: text("period_label").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  publishedById: uuid("published_by_id").references(() => users.id),
  ...auditColumns,
}, (table) => [
  uniqueIndex("executive_summary_org_app_period_active_idx")
    .on(table.organizationId, table.appKey, table.periodLabel)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const moduleFieldSettings = sharedSchema.table("module_field_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  module: executiveAppKey("module").notNull(),
  formKey: text("form_key").notNull(),
  fieldKey: text("field_key").notNull(),
  access: fieldAccessLevel("access").notNull().default("editable"),
  ...auditColumns,
}, (table) => [
  uniqueIndex("module_field_settings_org_module_form_field_active_idx")
    .on(table.organizationId, table.module, table.formKey, table.fieldKey)
    .where(sql`${table.deletedAt} IS NULL`),
]);
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
