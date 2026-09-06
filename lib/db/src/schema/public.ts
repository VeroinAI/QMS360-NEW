import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Diagnostic marker for Replit's Publish database provisioning.
 *
 * QMS360 stores product data in dedicated schemas. This harmless public-schema
 * table tests whether Publish currently requires a discoverable public table
 * before provisioning its separate production database.
 */
export const replitProvisioningProbe = pgTable("replit_provisioning_probe", {
  id: text("id").primaryKey().default("qms360"),
  purpose: text("purpose")
    .notNull()
    .default("Detect Replit production database provisioning"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});