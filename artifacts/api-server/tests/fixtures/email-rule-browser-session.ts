import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, organizations, platformRoles, users, emailEventRules, auditAuditLogEntries, pool } from "@workspace/db";
import { issueToken } from "../../src/lib/auth";

// Invoked by the browser test in a child process; session output is captured
// in memory, never written to a file or printed by the test runner.
try {
  if (process.argv[2] === "cleanup") {
    const organizationId = process.argv[3];
    if (!organizationId) throw new Error("Missing fixture organization");
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
    if (!organization?.code.startsWith("ERUI-")) throw new Error("Not a browser-test organization");
    for (const table of [auditAuditLogEntries, emailEventRules, users, platformRoles]) {
      await db.delete(table).where(eq(table.organizationId, organizationId));
    }
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  } else {
    const suffix = randomUUID();
    const [organization] = await db.insert(organizations).values({
      name: "Email rule browser test", code: `ERUI-${suffix}`,
    }).returning();
    const [role] = await db.insert(platformRoles).values({
      organizationId: organization!.id, name: "Org Admin",
    }).returning();
    const [admin] = await db.insert(users).values({
      organizationId: organization!.id, platformRoleId: role!.id,
      username: `email-ui-${suffix}`, email: `email-ui-${suffix}@example.invalid`,
      fullName: "Email UI administrator", accessStatus: "active",
    }).returning();
    process.stdout.write(JSON.stringify({ organizationId: organization!.id, token: issueToken(admin!) }));
  }
} finally {
  await pool.end();
}
