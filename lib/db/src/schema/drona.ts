import { check, foreignKey, primaryKey, text, timestamp, unique, bigint, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects, sharedSchema, users } from "./shared";

const reviewColumns = {
  environmentKey: text("environment_key").notNull(),
  organizationId: uuid("organization_id").notNull(),
  reviewReference: text("review_reference").notNull(),
  reviewedBy: uuid("reviewed_by").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
};

export const dronaUserLinks = sharedSchema.table("drona_user_links", {
  ...reviewColumns,
  externalUserId: bigint("external_user_id", { mode: "bigint" }).notNull(),
  userId: uuid("user_id").notNull(),
}, t => [
  primaryKey({ columns: [t.environmentKey, t.organizationId, t.externalUserId] }),
  unique("drona_user_links_environment_org_user_key").on(t.environmentKey, t.organizationId, t.userId),
  check("drona_user_links_environment_check", sql`${t.environmentKey} ~ '^[a-z][a-z0-9_-]{1,63}$'`),
  check("drona_user_links_source_id_check", sql`${t.externalUserId} > 0`),
  check("drona_user_links_review_check", sql`length(btrim(${t.reviewReference})) > 0`),
  foreignKey({ columns: [t.userId, t.organizationId], foreignColumns: [users.id, users.organizationId] }),
  foreignKey({ columns: [t.reviewedBy, t.organizationId], foreignColumns: [users.id, users.organizationId] }),
]);

export const dronaProjectLinks = sharedSchema.table("drona_project_links", {
  ...reviewColumns,
  externalProjectId: bigint("external_project_id", { mode: "bigint" }).notNull(),
  projectId: uuid("project_id").notNull(),
}, t => [
  primaryKey({ columns: [t.environmentKey, t.organizationId, t.externalProjectId] }),
  unique("drona_project_links_environment_org_project_key").on(t.environmentKey, t.organizationId, t.projectId),
  check("drona_project_links_environment_check", sql`${t.environmentKey} ~ '^[a-z][a-z0-9_-]{1,63}$'`),
  check("drona_project_links_source_id_check", sql`${t.externalProjectId} > 0`),
  check("drona_project_links_review_check", sql`length(btrim(${t.reviewReference})) > 0`),
  foreignKey({ columns: [t.projectId, t.organizationId], foreignColumns: [projects.id, projects.organizationId] }),
  foreignKey({ columns: [t.reviewedBy, t.organizationId], foreignColumns: [users.id, users.organizationId] }),
]);
