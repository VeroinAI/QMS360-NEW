import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessUnits, organizations, projects, users } from "./shared";

type AppSchema = ReturnType<typeof pgSchema>;

export function createAppAdministration(schema: AppSchema) {
  const evidenceStatus = schema.enum("evidence_status", ["uploading", "stored", "failed"]);
  const notificationChannel = schema.enum("notification_channel", ["in_app", "email"]);
  const auditColumns = {
    status: text("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
  const { status: _defaultStatus, ...softDeleteColumns } = auditColumns;

  const platformRoles = schema.table("platform_roles", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("platform_roles_org_name_active_idx").on(table.organizationId, table.name).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const permissions = schema.table("permissions", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("permissions_org_key_active_idx").on(table.organizationId, table.key).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const platformRolePermissions = schema.table("platform_role_permissions", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    platformRoleId: uuid("platform_role_id").notNull().references(() => platformRoles.id),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id),
    grant: text("grant").notNull().default("full"),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("platform_role_permission_active_idx").on(table.platformRoleId, table.permissionId).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const workspaceRoles = schema.table("workspace_roles", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("workspace_roles_org_name_active_idx").on(table.organizationId, table.name).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const workspaceRolePermissions = schema.table("workspace_role_permissions", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    workspaceRoleId: uuid("workspace_role_id").notNull().references(() => workspaceRoles.id),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id),
    grant: text("grant").notNull().default("full"),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("workspace_role_permission_active_idx").on(table.workspaceRoleId, table.permissionId).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const userWorkspaceRoles = schema.table("user_workspace_roles", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    workspaceRoleId: uuid("workspace_role_id").notNull().references(() => workspaceRoles.id),
    businessUnitIds: uuid("business_unit_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    projectIds: uuid("project_ids").array().notNull().default(sql`ARRAY[]::uuid[]`),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("user_workspace_role_active_idx").on(table.userId, table.workspaceRoleId).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const delegations = schema.table("delegations", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    delegatorId: uuid("delegator_id").notNull().references(() => users.id),
    delegateId: uuid("delegate_id").notNull().references(() => users.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
  });

  const escalationRules = schema.table("escalation_rules", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    triggerKey: text("trigger_key").notNull(),
    priority: text("priority"),
    slaWorkingDays: integer("sla_working_days").notNull(),
    recipientRole: text("recipient_role").notNull(),
    repeatCadenceDays: integer("repeat_cadence_days"),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
  });

  const escalationInstances = schema.table("escalation_instances", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    ruleId: uuid("rule_id").references(() => escalationRules.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    breachedAt: timestamp("breached_at", { withTimezone: true }),
    currentLevel: text("current_level"),
    nextEscalateAt: timestamp("next_escalate_at", { withTimezone: true }),
    stateNote: text("state_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...softDeleteColumns,
    status: text("status").notNull().default("open"),
  }, (table) => [
    uniqueIndex("escalation_instance_rule_record_active_idx")
      .on(table.ruleId, table.recordId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.status} = 'open'`),
  ]);

  const notifications = schema.table("notifications", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    recipientId: uuid("recipient_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    channel: text("channel").notNull().default("in_app"),
    recordType: text("record_type"),
    recordId: uuid("record_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...auditColumns,
  });

  const auditLogEntries = schema.table("audit_log_entries", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [index("audit_log_org_created_idx").on(table.organizationId, table.createdAt)]);

  const notificationTemplates = schema.table("notification_templates", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    bodyTemplate: text("body_template").notNull(),
    channel: notificationChannel("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...auditColumns,
  }, (table) => [
    uniqueIndex("notification_templates_org_key_active_idx").on(table.organizationId, table.key).where(sql`${table.deletedAt} IS NULL`),
  ]);

  const evidenceFiles = schema.table("evidence_files", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    projectId: uuid("project_id").references(() => projects.id),
    businessUnitId: uuid("business_unit_id").references(() => businessUnits.id),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    category: text("category").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    uploadedById: uuid("uploaded_by_id").notNull().references(() => users.id),
    status: evidenceStatus("status").notNull().default("uploading"),
    clientReference: varchar("client_reference", { length: 255 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }, (table) => [
    uniqueIndex("evidence_files_org_client_reference_active_idx").on(table.organizationId, table.clientReference).where(sql`${table.deletedAt} IS NULL AND ${table.clientReference} IS NOT NULL`),
    index("evidence_files_record_idx").on(table.recordType, table.recordId),
  ]);

  return {
    auditColumns,
    evidenceStatus,
    notificationChannel,
    platformRoles,
    permissions,
    platformRolePermissions,
    workspaceRoles,
    workspaceRolePermissions,
    userWorkspaceRoles,
    delegations,
    escalationRules,
    escalationInstances,
    notifications,
    auditLogEntries,
    notificationTemplates,
    evidenceFiles,
  };
}