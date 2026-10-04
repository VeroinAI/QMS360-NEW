import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  applicationAccess, auditAuditLogEntries, auditUserWorkspaceRoles, auditWorkspaceRoles,
  db, organizations, pool, projects, users,
} from "@workspace/db";
import {
  decideApplicationAccess, loadPendingApplicationRequestPage, pendingApplicationRequests,
  type Access, type Member,
} from "../src/lib/application-access-requests";

let organizationId: string, roleId: string, projectId: string, outsideId: string;
let records: Access[], members: Member[];
const statements: Array<{ query: string; params: unknown[] }> = [];
const measured = drizzle(pool, { logger: { logQuery(query, params) { statements.push({ query, params }); } } });
const suffix = crypto.randomUUID().slice(0, 8);
const request = (scoped = false) => ({
  currentUser: { organizationId, id: members[0]!.id },
  permissionAdminBypass: !scoped,
  permissionProjectScope: { unrestricted: false, projectIds: [projectId] },
  params: {}, ip: "127.0.0.1",
}) as unknown as Request;

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `Queue Scale ${suffix}`, code: `QS${suffix}` }).returning();
  organizationId = org!.id;
  const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId, name: "Scale Reviewer" }).returning();
  roleId = role!.id;
  const [managed, outside] = await db.insert(projects).values([
    { organizationId, name: "Managed", code: "managed" }, { organizationId, name: "Outside", code: "outside" },
  ]).returning();
  projectId = managed!.id; outsideId = outside!.id;
  const people = await db.insert(users).values(Array.from({ length: 1200 }, (_, n) => ({
    organizationId, username: `scale-${suffix}-${String(n).padStart(4, "0")}`,
    fullName: `Scale ${n}`, email: `scale-${n}@example.invalid`,
  }))).returning();
  const assigned = await db.insert(auditUserWorkspaceRoles).values(people.map((user, n) => ({
    organizationId, userId: user.id, workspaceRoleId: roleId,
    projectIds: n % 3 === 0 ? [outsideId] : n % 3 === 1 ? [projectId] : [projectId, outsideId],
    updatedAt: new Date("2026-01-01"),
  }))).returning();
  members = people.map((user, n) => ({
    id: user.id, username: user.username, fullName: user.fullName, email: user.email, roleId,
    projectIds: assigned[n]!.projectIds, businessUnitIds: [], updatedAt: assigned[n]!.updatedAt,
  }));
  records = await db.insert(applicationAccess).values(people.map((user, n) => ({
    organizationId, username: user.username, status: "active", canOpenLessons: true,
    canOpenAudit: n >= 1000, applicationReviews: n < 8 ? {} : {
      audit: { status: "pending" as const, reviewedAt: "2026-01-02T00:00:00Z" },
    }, createdAt: new Date("2026-01-01"),
  }))).returning();
  // Large organization history should not be returned to the application or
  // scanned once for every explicit modern review.
  await db.execute(sql`insert into ${auditAuditLogEntries}
    (organization_id, entity_type, entity_id, action, created_at)
    select ${organizationId}::uuid, 'application_access', gen_random_uuid(), 'reject_access', now()
    from generate_series(1, 50000)`);
  await db.insert(auditAuditLogEntries).values(records.slice(0, 8).flatMap((record, n) => [
    { organizationId, entityType: "application_access", entityId: record.id,
      action: n % 2 ? "request_access" : "reject_access", createdAt: new Date("2026-01-02") },
    { organizationId, entityType: "access_request", entityId: record.id,
      action: "request_access", createdAt: new Date("2026-01-03") },
  ]));
}, 30000);

afterAll(async () => {
  if (!organizationId) return;
  for (const table of [applicationAccess, auditAuditLogEntries, auditUserWorkspaceRoles, auditWorkspaceRoles, users, projects]) {
    await db.delete(table).where(eq(table.organizationId, organizationId));
  }
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

describe("Batched queue resolution with 1,200 users and 50,000 historical decisions", () => {
  it("paginates after resolving legacy outcomes, with exact totals and deterministic timestamp ties", async () => {
    const transitioned = records.map((row, n) => n >= 8 ? row : ({
      ...row, applicationReviews: { audit: {
        status: n % 2 ? "pending" as const : "rejected" as const, reviewedAt: "2026-01-02T00:00:00Z",
      } },
    }));
    const expected = pendingApplicationRequests("audit", transitioned, members, () => true);
    statements.length = 0;
    const started = performance.now();
    const page = await loadPendingApplicationRequestPage(request(), "audit", 237, 40, measured);
    expect(page).toEqual({ items: expected.slice(237, 277), total: expected.length });
    expect(performance.now() - started).toBeLessThan(10000);
    const legacyQueries = statements.filter(row => row.query.includes("json_build_object"));
    expect(legacyQueries).toHaveLength(1);
    const lookedUp = legacyQueries.flatMap(row => row.params.filter(param => records.some(record => record.id === param)));
    expect(lookedUp.sort()).toEqual(records.slice(0, 8).map(row => row.id).sort());
    // All four access batches are username-bounded; already approved users
    // never reach the resolver, and legacy lookups return one row per entity.
    const accessQueries = statements.filter(row => row.query.includes('from "shared"."application_access"')
      && row.query.includes('"username" in (') && !row.query.includes("union"));
    expect(accessQueries).toHaveLength(4);
    expect(accessQueries.every(row => row.params.length <= 251)).toBe(true);
    const next = await loadPendingApplicationRequestPage(request(), "audit", 277, 40, measured);
    expect(next.items).toEqual(expected.slice(277, 317));
    expect(new Set([...page.items, ...next.items].map(row => row.id)).size).toBe(80);
    const empty = await loadPendingApplicationRequestPage(request(), "audit", 2000, 40, measured);
    expect(empty).toEqual({ items: [], total: expected.length });
  }, 20000);

  it("filters candidate assignments by full project containment, never by overlap alone", async () => {
    const visible = (ids: string[]) => ids.length > 0 && ids.every(id => id === projectId);
    const transitioned = records.map((row, n) => n >= 8 ? row : ({
      ...row, applicationReviews: { audit: {
        status: n % 2 ? "pending" as const : "rejected" as const, reviewedAt: "2026-01-02T00:00:00Z",
      } },
    }));
    const expected = pendingApplicationRequests("audit", transitioned, members, visible);
    const page = await loadPendingApplicationRequestPage(request(true), "audit", 0, 30, measured);
    expect(page).toEqual({ items: expected.slice(0, 30), total: expected.length });
  });

  it("uses the selective access-decision index instead of unrelated organization history", async () => {
    await db.execute(sql`analyze ${auditAuditLogEntries}`);
    const plan = await db.execute(sql`explain (analyze, buffers, format json)
      select id from ${auditAuditLogEntries}
      where organization_id = ${organizationId} and entity_id = ${records[0]!.id}
        and entity_type in ('application_access', 'access_request')
        and action in ('access_reject', 'access_approve', 'reject_access', 'approve_access', 'request_access')`);
    expect(JSON.stringify(plan.rows)).toContain("audit_log_access_decision_entity_idx");
  });

  it("does not serialize unrelated users behind another user's cross-application lock", async () => {
    const lockedUsername = members[20]!.username;
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const blocker = db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}),
        hashtext(${`application-access:${lockedUsername}`}))`);
      acquired();
      await gate;
    });
    await ready;
    try {
      const req = request();
      req.params.id = records[21]!.id;
      const decision = decideApplicationAccess(req, "audit", "approve");
      const outcome = await Promise.race([decision, new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))]);
      expect(outcome).not.toBeNull();
      expect(outcome!.canOpenAudit).toBe(true);
      await decision;
    } finally {
      release(); await blocker;
    }
  });
});