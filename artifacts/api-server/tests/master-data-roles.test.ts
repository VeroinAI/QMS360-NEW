import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import pino from "pino";
import {
  db, organizations, users, platformRoles, masterDataGroups, masterDataValues,
  workspaceRoles, lessonsWorkspaceRoles, auditWorkspaceRoles,
  auditLogEntries, lessonsAuditLogEntries, auditAuditLogEntries,
} from "@workspace/db";
import router from "../src/routes/master-data";
import { issueToken } from "../src/lib/auth";

let server: Server, base: string, orgId: string, foreignOrgId: string;
let adminToken: string, memberToken: string, groupId: string, globalGroupId: string;
let firstRole: string, secondRole: string, foreignRole: string, inactiveRole: string;
const assignment = (roleId: string, application = "audit") => ({ application, roleId });
async function request(method: string, path: string, body?: unknown, token = adminToken) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org, foreign] = await db.insert(organizations).values([
    { name: "Master role test", code: `MR${suffix}` }, { name: "Other master role test", code: `MF${suffix}` },
  ]).returning();
  orgId = org!.id; foreignOrgId = foreign!.id;
  const [platform] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin" }).returning();
  const [admin, member] = await db.insert(users).values([
    { organizationId: orgId, fullName: "Master Administrator", email: `mr.admin.${suffix}@test.invalid`, username: `mra${suffix}`, platformRoleId: platform!.id },
    { organizationId: orgId, fullName: "Master Member", email: `mr.member.${suffix}@test.invalid`, username: `mrm${suffix}` },
  ]).returning();
  adminToken = issueToken(admin!); memberToken = issueToken(member!);
  const [one, two, inactive, other] = await db.insert(auditWorkspaceRoles).values([
    { organizationId: orgId, name: "Auditee" }, { organizationId: orgId, name: "Audit Lead" },
    { organizationId: orgId, name: "Retired", status: "inactive" }, { organizationId: foreignOrgId, name: "Foreign role" },
  ]).returning();
  firstRole = one!.id; secondRole = two!.id; inactiveRole = inactive!.id; foreignRole = other!.id;
  // Application + ID identifies a role even when different applications share an ID/name.
  await db.insert(workspaceRoles).values({ organizationId: orgId, id: firstRole, name: "Auditee" });
  const [auditGroup, globalGroup] = await db.insert(masterDataGroups).values([
    { organizationId: orgId, code: "role_test_audit", name: "Audit test", appScope: "audit" },
    { organizationId: orgId, code: "role_test_global", name: "Global test", appScope: "global" },
  ]).returning();
  groupId = auditGroup!.id; globalGroupId = globalGroup!.id;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = pino({ level: "silent" }); next(); });
  app.use("/api", router);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  base = `http://127.0.0.1:${address.port}/api/platform/master-data`;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const id of [orgId, foreignOrgId].filter(Boolean)) {
    for (const table of [auditLogEntries, lessonsAuditLogEntries, auditAuditLogEntries, masterDataValues, masterDataGroups,
      workspaceRoles, lessonsWorkspaceRoles, auditWorkspaceRoles, users, platformRoles]) {
      await db.delete(table).where(eq(table.organizationId, id));
    }
    await db.delete(organizations).where(eq(organizations.id, id));
  }
});

describe("Master Data informational role assignments", () => {
  it("offers organization application roles only and requires an administrator", async () => {
    const result = await request("GET", "/roles");
    expect(result.status).toBe(200);
    expect(result.body.items.some((role: { id: string }) => role.id === foreignRole)).toBe(false);
    expect(result.body.items.filter((role: { id: string }) => role.id === firstRole)).toHaveLength(2);
    expect(result.body.items.find((role: { id: string }) => role.id === inactiveRole).active).toBe(false);
    expect((await request("GET", "/roles", undefined, memberToken)).status).toBe(403);
  });
  it("creates, reopens, edits, removes and clears roles without losing other metadata or hiding values", async () => {
    const created = await request("POST", `/groups/${groupId}/values`, {
      value: "Activity A", metadata: { assignedRoles: [assignment(firstRole)], activityDefaultRemarks: "Keep these remarks", auditTypeValues: ["Internal Audit"] },
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(created.body.metadata.assignedRoles).toEqual([assignment(firstRole)]);
    const edited = await request("PUT", `/values/${id}`, { metadata: { assignedRoles: [assignment(firstRole), assignment(secondRole), assignment(firstRole)] } });
    expect(edited.status).toBe(200);
    expect(edited.body.metadata.assignedRoles).toEqual([assignment(firstRole), assignment(secondRole)]);
    expect(edited.body.metadata.activityDefaultRemarks).toBe("Keep these remarks");
    expect(edited.body.metadata.auditTypeValues).toEqual(["Internal Audit"]);
    const reopened = await request("GET", "");
    expect(reopened.body.items.find((group: { id: string }) => group.id === groupId).values[0].metadata.assignedRoles).toHaveLength(2);
    const lov = await request("GET", "/lov/role_test_audit", undefined, memberToken);
    expect(lov.status).toBe(200);
    expect(lov.body.values[0].value).toBe("Activity A"); // Unassigned users still see/select the value.
    expect((await request("PUT", `/values/${id}`, { label: "Renamed" })).body.metadata.assignedRoles).toHaveLength(2);
    expect((await request("PUT", `/values/${id}`, { metadata: { assignedRoles: [assignment(secondRole)] } })).body.metadata.assignedRoles).toEqual([assignment(secondRole)]);
    const cleared = await request("PUT", `/values/${id}`, { metadata: { assignedRoles: [] } });
    expect(cleared.body.metadata.assignedRoles).toEqual([]);
    expect(cleared.body.metadata.activityDefaultRemarks).toBe("Keep these remarks");
  });
  it("rejects foreign, inactive, unknown, mismatched and malformed assignments", async () => {
    for (const assignedRoles of [
      [assignment(foreignRole)], [assignment(inactiveRole)], [assignment(crypto.randomUUID())],
      [assignment(firstRole, "qaqc")], [{ application: "audit" }], "not an array",
    ]) {
      const result = await request("POST", `/groups/${groupId}/values`, { value: crypto.randomUUID(), metadata: { assignedRoles } });
      expect(result.status).toBe(422);
    }
  });
  it("allows global groups to store roles from multiple applications", async () => {
    const assignedRoles = [assignment(firstRole), assignment(firstRole, "qaqc")];
    const result = await request("POST", `/groups/${globalGroupId}/values`, { value: "Shared", metadata: { assignedRoles } });
    expect(result.status).toBe(201);
    expect(result.body.metadata.assignedRoles).toEqual(assignedRoles);
  });
});