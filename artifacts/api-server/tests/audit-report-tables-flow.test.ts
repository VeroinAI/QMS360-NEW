import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, organizations, projects, platformRoles, users, auditSchedules, auditPlans, audits,
  auditWorkspaceRoles, auditPermissions, auditWorkspaceRolePermissions, auditUserWorkspaceRoles,
  organizationSettings } from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";

const org = randomUUID(), suffix = randomUUID(), people: string[] = [], tokens: string[] = [];
let server: Server, base: string, projectId: string;
async function request(path: string, person = 0) {
  return fetch(`${base}/api/audit/reports/table/${path}`, { headers: { authorization: `Bearer ${tokens[person]}` } });
}
beforeAll(async () => {
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await db.insert(organizations).values({ id: org, name: "Isolated report table fixture", code: suffix });
  const roles = await db.insert(platformRoles).values([
    { organizationId: org, name: "Org Admin", isSystem: true }, { organizationId: org, name: "Employee", isSystem: true },
  ]).returning();
  const persons = await db.insert(users).values(["Admin", "Scoped Reports Reader", "No Reports Access"].map((name, i) => ({
    organizationId: org, platformRoleId: roles[i ? 1 : 0].id,
    username: `${suffix}-${i}`, email: `${suffix}-${i}@example.invalid`, fullName: name,
  }))).returning();
  persons.forEach(person => { people.push(person.id); tokens.push(issueToken(person)); });
  const ps = await db.insert(projects).values(["Authorized", "Other project"].map((name, i) => ({
    organizationId: org, code: `${suffix}-${i}`, name,
  }))).returning();
  projectId = ps[0].id;
  const [role] = await db.insert(auditWorkspaceRoles).values({ organizationId: org, name: "Scoped Reports" }).returning();
  const [permission] = await db.insert(auditPermissions).values({ organizationId: org,
    key: "audit.reports.view_all", label: "Reports", category: "Audit" }).returning();
  await db.insert(auditWorkspaceRolePermissions).values({ organizationId: org, workspaceRoleId: role.id,
    permissionId: permission.id, grant: "full" });
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: org, workspaceRoleId: role.id, userId: people[1], projectIds: [projectId] });
  for (const [i, p] of ps.entries()) {
    const [schedule] = await db.insert(auditSchedules).values({ organizationId: org, projectId: p.id,
      year: i ? 2024 : 2026, title: `${p.name} audit`, status: JSON.stringify({ projectIds: [p.id],
        auditNumber: `AUD-${i}`, qaqcReference: `REF-${i}`, plannedStartDate: "2026-11-01", plannedEndDate: "2026-11-03" }) }).returning();
    const [plan] = await db.insert(auditPlans).values({ organizationId: org, projectId: p.id, auditScheduleId: schedule.id }).returning();
    await db.insert(audits).values({ organizationId: org, projectId: p.id, auditPlanId: plan.id, referenceNumber: `EXEC-${i}`,
      status: JSON.stringify({ title: `${p.name} execution` }) });
  }
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const table of [audits, auditPlans, auditSchedules, auditUserWorkspaceRoles, auditWorkspaceRolePermissions,
    auditPermissions, auditWorkspaceRoles, organizationSettings, users, platformRoles, projects] as const)
    await db.delete(table).where(eq(table.organizationId, org));
  await db.delete(organizations).where(eq(organizations.id, org));
});
describe("Audit report table API", () => {
  it("serves all four workbook tables and supports filters and pagination", async () => {
    for (const [report, count] of [["open-vs-closed", 18], ["findings-log", 18], ["car-status", 19], ["schedule", 15]] as const) {
      const response = await request(report);
      expect(response.status).toBe(200);
      expect((await response.json()).columns).toHaveLength(count);
    }
    const page = await (await request("open-vs-closed?limit=1&page=2")).json();
    expect(page.availableYears).toEqual([2026, 2024]);
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    const filtered = await (await request("open-vs-closed?search=Authorized&year=2026")).json();
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0].values[5]).toBe("Authorized");
  });
  it("uses Reports scope, without needing independent Plan, Schedule or Project grants", async () => {
    for (const report of ["open-vs-closed", "schedule"]) {
      const response = await request(report, 1);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total).toBe(1);
      expect(data.availableYears).toEqual([2026]);
      expect(JSON.stringify(data)).toContain("Authorized");
      expect(JSON.stringify(data)).not.toContain("Other project");
    }
  });
  it("rejects unauthorized viewing and exporting", async () => {
    expect((await request("open-vs-closed", 2)).status).toBe(403);
    expect((await request("open-vs-closed?format=csv", 1)).status).toBe(403);
  });
  it("exports the entire filtered dataset, not just one page, with workbook headers", async () => {
    const response = await request("schedule?format=csv&limit=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv).toContain('"Audit Schedule","Audit Number","Audit Title"');
    expect(csv).toContain("Authorized audit");
    expect(csv).toContain("Other project audit");
  });
  it("validates report selectors and query parameters", async () => {
    expect((await request("unknown")).status).toBe(404);
    for (const params of ["page=1.5", "year=2026.5", "limit=0", "year=bad"])
      expect((await request(`schedule?${params}`)).status).toBe(422);
  });
});
