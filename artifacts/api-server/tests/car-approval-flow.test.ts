import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { db, organizations, users, platformRoles, projects, auditWorkspaceRoles, auditUserWorkspaceRoles,
  auditWorkspaceRolePermissions, auditPermissions, auditSchedules, auditPlans, audits, auditFindings,
  correctiveActionReports, auditNotifications, auditAuditLogEntries, organizationSettings, masterDataGroups, masterDataValues } from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { saveCarNumbering } from "../src/lib/audit-car-numbering";
import { readCarSignature } from "../src/lib/car-signature-evidence";

const storage = vi.hoisted(() => ({ get: vi.fn(), store: vi.fn() }));
vi.mock("../src/lib/objectStorage", () => ({ getObject: storage.get, storeObject: storage.store }));

const suffix = randomUUID().slice(0,8);
let server: Server, base: string, orgId: string, foreignOrg: string, projectId: string, otherProject: string, departmentId: string, otherDepartment: string;
const tokens: string[] = [], ids: string[] = [], roles: string[] = [];
const response = { rootCause: "Recorded root cause", correction: "Recorded correction", correctiveAction: "Recorded corrective action" };
async function call(method: string, path: string, who = 0, data?: unknown) {
  const result = await fetch(`${base}/api/audit${path}`, { method, headers: { authorization: `Bearer ${tokens[who]}`, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: result.status, body: await result.json() };
}
async function role(name: string, level: number | null, keys: string[]) {
  const id = randomUUID();
  const result = await call("POST", "/admin/roles", 0, { id, name: `${name}-${suffix}`, description: "", active: true,
    roleAuthorizationLevel: level, permissions: keys.map(key => ({ key, name: key })) });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return id;
}
async function makeCar(project: string | null = projectId, dept = departmentId) {
  const [schedule] = await db.insert(auditSchedules).values({ organizationId: orgId, projectId: project,
    title: `CAR approval audit ${suffix}`, year: 2026,
    status: JSON.stringify({ plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-05", auditTypes: [project ? "Quality Internal Product Audit" : "Quality Internal Process Audit"], departmentProject: project ? undefined : dept }) }).returning();
  const [plan] = await db.insert(auditPlans).values({ organizationId: orgId, projectId: project, auditScheduleId: schedule!.id,
    status: JSON.stringify({ leadAuditorId: ids[7] }) }).returning();
  const itemId = randomUUID();
  const [audit] = await db.insert(audits).values({ organizationId: orgId, projectId: project, auditPlanId: plan!.id,
    referenceNumber: `CAR-${randomUUID()}`, checklistState: [{ id: itemId, auditFinding: "Major NC", findingDate: "2026-10-01", description: "Recorded finding", actionTakerId: ids[0] }] }).returning();
  const [finding] = await db.insert(auditFindings).values({ organizationId: orgId, auditId: audit!.id,
    classification: "Major NC", responsibleDepartment: "Quality", evidence: { sourceChecklistItemId: itemId } }).returning();
  const [car] = await db.insert(correctiveActionReports).values({ organizationId: orgId, auditFindingId: finding!.id,
    ownerId: ids[0], responsibleDepartment: "Quality", ...response, workflowState: "draft",
    effectivenessNotes: JSON.stringify({ sourceChecklistItemId: itemId, retainedCustom: { value: "keep" } }) }).returning();
  return { id: car!.id, auditId: audit!.id, planId: plan!.id };
}
beforeAll(async () => {
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [org] = await db.insert(organizations).values({ name: `CAR approval ${suffix}`, code: `CA${suffix}` }).returning(); orgId = org!.id;
  const platform = await db.insert(platformRoles).values([{ organizationId: orgId, name: "Org Admin", isSystem: true }, { organizationId: orgId, name: "Employee", isSystem: true }]).returning();
  const people = await db.insert(users).values(["Action Taker", "First reviewer", "Alternative reviewer", "Final reviewer", "Other project reviewer", "Unit-only reviewer", "Department reviewer", "Legacy Plan Lead", "No read reviewer"].map((fullName, i) => ({
    organizationId: orgId, platformRoleId: platform[i ? 1 : 0]!.id, fullName, username: `car-approval-${i}-${suffix}`, email: `car-approval-${i}-${suffix}@example.test`,
  }))).returning();
  people.forEach(user => { ids.push(user.id); tokens.push(issueToken(user)); });
  const p = await db.insert(projects).values(["Approval project", "Other project"].map((name, i) => ({ organizationId: orgId, name, code: `CA${i}${suffix}`, customFields: { qmsAdditionalData: { contractProjectNumber: `CA${i}` } } }))).returning();
  projectId = p[0]!.id; otherProject = p[1]!.id;
  const [group] = await db.insert(masterDataGroups).values({ organizationId: orgId, code: "Department", name: "Department Master" }).returning();
  const departments = await db.insert(masterDataValues).values(["Quality", "Engineering"].map((label, i) => ({ organizationId: orgId, groupId: group!.id, value: `CARDEP${i}${suffix}`, label, metadata: { costId: `DEP${i}` } }))).returning();
  departmentId = departments[0]!.id; otherDepartment = departments[1]!.id;
  for (let i = 1; i <= 8; i++) {
    const keys = i === 7 ? ["audit.cars.view_all", "audit_team_lead"] : [...(i === 8 ? [] : ["audit.cars.view_all"]), "audit.cars.approve_reject"];
    const id = await role(`Reviewer ${i}`, i === 3 ? 3 : 1, keys); roles[i] = id;
    await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: ids[i]!, workspaceRoleId: id,
      projectIds: i === 4 ? [otherProject] : i === 5 || i === 6 ? [] : [projectId],
      businessUnitIds: i === 5 ? [randomUUID()] : [], departmentIds: i === 6 ? [departmentId] : [] });
  }
  const readRole = await role("Broad read only", null, ["audit.cars.view_all"]);
  await db.insert(auditUserWorkspaceRoles).values({ organizationId: orgId, userId: ids[5]!, workspaceRoleId: readRole });
  const [foreign] = await db.insert(organizations).values({ name: `Other CAR tenant ${suffix}`, code: `CF${suffix}` }).returning(); foreignOrg = foreign!.id;
  const [foreignRole] = await db.insert(platformRoles).values({ organizationId: foreignOrg, name: "Org Admin", isSystem: true }).returning();
  const [foreignUser] = await db.insert(users).values({ organizationId: foreignOrg, platformRoleId: foreignRole!.id, fullName: "Foreign administrator", username: `foreign-${suffix}`, email: `foreign-${suffix}@example.test` }).returning();
  tokens[9] = issueToken(foreignUser!);
  await saveCarNumbering(orgId, { prefix: "QA", middle: "CAR", separator: "-", padding: 4 });
}, 30000);
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (process.env.QMS_CAR_APPROVAL_BROWSER === "1") {
    const browserCar = await makeCar();
    await writeFile("/tmp/qms-car-approval-browser.json", JSON.stringify({ orgId, projectId, carId: browserCar.id, tokens, ids, roles }), { mode: 0o600 });
    return;
  }
  for (const org of [orgId, foreignOrg].filter(Boolean)) {
    for (const table of [auditNotifications, auditAuditLogEntries, correctiveActionReports, auditFindings, audits, auditPlans, auditSchedules,
      auditWorkspaceRolePermissions, auditUserWorkspaceRoles, auditWorkspaceRoles, auditPermissions, organizationSettings,
      masterDataValues, masterDataGroups, users, platformRoles, projects]) await db.delete(table).where(eq(table.organizationId, org));
    await db.delete(organizations).where(eq(organizations.id, org));
  }
});
describe("Configured CAR approvals through the real API", () => {
  it("persists CAR-only and combined roles, validates levels, and does not grant Schedule/Report approval", async () => {
    for (const level of [null,0,-1,1.5]) {
      const result = await call("POST", "/admin/roles", 0, { id: randomUUID(), name: "Invalid level", active: true,
        roleAuthorizationLevel: level, permissions: [{ key: "audit.cars.approve_reject", name: "CAR approval" }] });
      expect(result.status).toBe(422);
    }
    const id = await role("CAR-only editor", 2, ["approve_reject", "audit.cars.approve_reject"]);
    let saved = (await call("GET", "/admin/roles?limit=200")).body.items.find((r: any) => r.id === id);
    expect(saved.permissions.map((p: any) => p.key).sort()).toEqual(["approve_reject", "audit.cars.approve_reject"]);
    const update = await call("PUT", `/admin/roles/${id}`, 0, { ...saved, permissions: [...saved.permissions, { key: "audit.audits.approve_reject", name: "Reports" }, { key: "audit.schedules.approve_reject", name: "Schedules" }], roleAuthorizationLevel: 4 });
    expect(update.status).toBe(200);
    saved = (await call("GET", "/admin/roles?limit=200")).body.items.find((r: any) => r.id === id);
    expect(saved.roleAuthorizationLevel).toBe(4);
    expect(saved.permissions).toHaveLength(4);
  });
  it("snapshots levels and alternatives, excludes unrelated scope, enforces read access, and keeps metadata/number", async () => {
    const car = await makeCar();
    const submitted = await call("PUT", `/cars/${car.id}`, 0, { ...response, saveAndSubmit: true });
    expect(submitted.status).toBe(200); expect(submitted.body.approval.pendingLevel).toBe(1);
    expect(submitted.body.carNumber).toBeTruthy();
    const [stored] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, car.id));
    const meta = JSON.parse(stored!.effectivenessNotes!);
    expect(meta.retainedCustom).toEqual({ value: "keep" });
    expect(meta.carApproval.steps.map((s: any) => s.level)).toEqual([1,3]);
    expect(meta.carApproval.steps[0].approvers.map((p: any) => p.id).sort()).toEqual([ids[1],ids[2],ids[8]].sort());
    expect((await call("POST", `/cars/${car.id}/review`, 4, { decision: "accept" })).status).toBe(403);
    expect((await call("POST", `/cars/${car.id}/review`, 5, { decision: "accept" })).status).toBe(403);
    expect((await call("POST", `/cars/${car.id}/review`, 8, { decision: "accept" })).status).toBe(403);
    expect((await call("POST", `/cars/${car.id}/review`, 3, { decision: "accept" })).status).toBe(403);
    expect((await call("GET", `/cars/${car.id}`, 9)).status).toBe(404);
    expect((await call("PUT", `/cars/${car.id}`, 0, response)).status).toBe(409);
    const queue = await call("GET", "/my-actions", 2);
    expect(queue.body.items.find((item: any) => item.id === car.id).action).toBe("Review Level 1");
    const projected = await call("GET", "/car-register", 2);
    expect(projected.body.items.find((item: any) => item.car?.id === car.id).canReview).toBe(true);
    const advanced = await call("POST", `/cars/${car.id}/review`, 2, { decision: "accept" });
    expect(advanced.body.status).toBe("Submitted"); expect(advanced.body.approval.pendingLevel).toBe(3);
    expect((await call("POST", `/cars/${car.id}/review`, 1, { decision: "accept" })).status).toBe(403);
    const closed = await call("POST", `/cars/${car.id}/review`, 3, { decision: "accept" });
    expect(closed.body.status).toBe("Closed"); expect(closed.body.approval.history).toHaveLength(2);
    expect(closed.body.carNumber).toBe(submitted.body.carNumber);
    const [after] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, car.id));
    expect(JSON.parse(after!.effectivenessNotes!).retainedCustom).toEqual({ value: "keep" });
    expect((await call("POST", `/cars/${car.id}/submit`)).status).toBe(409);
    const notices = await db.select().from(auditNotifications).where(and(eq(auditNotifications.organizationId, orgId), eq(auditNotifications.recordId, car.id)));
    expect(notices.filter(n => n.recipientId === ids[3] && n.title.startsWith("CAR response awaiting"))).toHaveLength(1);
    expect(notices.filter(n => n.recipientId === ids[0] && ["CAR closed", "CAR advanced to next Approval Level"].includes(n.title))).toHaveLength(2);
  });
  it("requires remarks, returns to the owner, and restarts on both query and rework resubmissions", async () => {
    const car = await makeCar();
    const initial = await call("POST", `/cars/${car.id}/submit`);
    expect(initial.status).toBe(200);
    for (const decision of ["query","rework"]) {
      expect((await call("POST", `/cars/${car.id}/review`, 1, { decision })).status).toBe(422);
      const returned = await call("POST", `/cars/${car.id}/review`, 1, { decision, comments: "Please clarify" });
      expect(returned.body.status).toBe(`Returned for ${decision}`);
      expect((await call("GET", `/cars/${car.id}`)).body.canRespond).toBe(true);
      const resubmitted = await call("PUT", `/cars/${car.id}`, 0, { ...response, saveAndSubmit: true });
      expect(resubmitted.body.approval.pendingLevel).toBe(1);
      expect(resubmitted.body.carNumber).toBe(initial.body.carNumber);
    }
    expect((await call("GET", `/cars/${car.id}`)).body.approval.history).toHaveLength(2);
  });
  it("captures only on submission, refreshes on resubmission and retains evidence through final acceptance", async () => {
    const objects = new Map<string, Uint8Array>();
    const image = async (color: string) => new Uint8Array(await sharp({
      create: { width: 100, height: 30, channels: 4, background: color },
    }).png().toBuffer());
    objects.set("/profile-a", await image("#123456"));
    objects.set("/profile-b", await image("#654321"));
    storage.get.mockImplementation(async path => {
      if (!objects.has(path)) throw new Error("Object storage download returned 404");
      return new Response(objects.get(path)!, { headers: { "content-type": "image/png" } });
    });
    storage.store.mockImplementation(async (path, bytes) => {
      objects.set(`/private/${path}`, new Uint8Array(bytes));
      return `/private/${path}`;
    });
    const car = await makeCar();
    const metadata = async () => {
      const [row] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, car.id));
      return JSON.parse(row!.effectivenessNotes!);
    };
    try {
      await db.update(users).set({ signaturePath: "gcs:/profile-a" }).where(eq(users.id, ids[0]!));
      expect((await call("PUT", `/cars/${car.id}`, 0, response)).status).toBe(200);
      expect((await metadata()).carRecipientSignature).toBeUndefined();
      expect((await call("POST", `/cars/${car.id}/submit`)).status).toBe(200);
      const first = (await metadata()).carRecipientSignature;
      expect(first).toMatchObject({ organizationId: orgId, recordId: car.id, userId: ids[0] });
      const firstBytes = await readCarSignature(first, orgId, car.id);
      await db.update(users).set({ signaturePath: "gcs:/profile-b" }).where(eq(users.id, ids[0]!));
      expect(await readCarSignature(first, orgId, car.id)).toEqual(firstBytes);
      expect((await call("POST", `/cars/${car.id}/review`, 1, { decision: "query", comments: "Clarify" })).status).toBe(200);
      // A storage outage must roll back submission and retain prior evidence.
      storage.store.mockRejectedValueOnce(new Error("Signature storage unavailable"));
      const failed = await fetch(`${base}/api/audit/cars/${car.id}`, { method: "PUT",
        headers: { authorization: `Bearer ${tokens[0]}`, "content-type": "application/json" },
        body: JSON.stringify({ ...response, saveAndSubmit: true }),
      });
      expect(failed.status).toBe(500);
      expect((await metadata()).carRecipientSignature).toEqual(first);
      expect((await call("PUT", `/cars/${car.id}`, 0, { ...response, saveAndSubmit: true })).status).toBe(200);
      const second = (await metadata()).carRecipientSignature;
      expect(second.path).not.toBe(first.path);
      const secondBytes = await readCarSignature(second, orgId, car.id);
      expect(secondBytes).not.toEqual(firstBytes);
      await db.update(users).set({ signaturePath: null }).where(eq(users.id, ids[0]!));
      expect((await call("POST", `/cars/${car.id}/review`, 1, { decision: "accept" })).status).toBe(200);
      expect((await call("POST", `/cars/${car.id}/review`, 3, { decision: "accept" })).body.status).toBe("Closed");
      expect((await metadata()).carRecipientSignature).toEqual(second);
      expect(await readCarSignature(second, orgId, car.id)).toEqual(secondBytes);
    } finally {
      await db.update(users).set({ signaturePath: null }).where(eq(users.id, ids[0]!));
    }
  });
  it("prevents revoked reviewers, missing next levels, concurrent decisions and close/extension bypasses", async () => {
    const car = await makeCar();
    await call("POST", `/cars/${car.id}/submit`);
    for (const path of ["close", "extension", "extension/review", "extension/cancel"]) {
      expect((await call("POST", `/cars/${car.id}/${path}`, 0, { reason: "Need time", requestedDueDate: "2027-01-01", decision: "approve" })).status).toBe(409);
    }
    await db.update(auditUserWorkspaceRoles).set({ status: "inactive" }).where(eq(auditUserWorkspaceRoles.workspaceRoleId, roles[3]!));
    expect((await call("POST", `/cars/${car.id}/review`, 1, { decision: "accept" })).body.error).toMatch(/Level 3 has no eligible/);
    await db.update(auditUserWorkspaceRoles).set({ status: "active" }).where(eq(auditUserWorkspaceRoles.workspaceRoleId, roles[3]!));
    await db.update(auditUserWorkspaceRoles).set({ status: "inactive" }).where(eq(auditUserWorkspaceRoles.workspaceRoleId, roles[1]!));
    expect((await call("POST", `/cars/${car.id}/review`, 1, { decision: "accept" })).status).toBe(403);
    await db.update(auditUserWorkspaceRoles).set({ status: "active" }).where(eq(auditUserWorkspaceRoles.workspaceRoleId, roles[1]!));
    const results = await Promise.all([1,2].map(who => call("POST", `/cars/${car.id}/review`, who, { decision: "accept" })));
    expect(results.filter(result => result.status === 200)).toHaveLength(1);
    expect(results.filter(result => [403,409].includes(result.status))).toHaveLength(1);
    const saved = await call("GET", `/cars/${car.id}`);
    expect(saved.body.approval.history).toHaveLength(1);
    expect(saved.body.approval.pendingLevel).toBe(3);
  });
  it("uses department-coupled CAR assignments and fails explicitly for unconfigured scopes", async () => {
    await db.update(auditWorkspaceRoles).set({ roleAuthorizationLevel: null }).where(eq(auditWorkspaceRoles.id, roles[6]!));
    const invalid = await makeCar(null);
    const invalidResult = await call("POST", `/cars/${invalid.id}/submit`);
    expect(invalidResult.status).toBe(409);
    expect(invalidResult.body.error).toMatch(/Approval Level/);
    await db.update(auditWorkspaceRoles).set({ roleAuthorizationLevel: 1 }).where(eq(auditWorkspaceRoles.id, roles[6]!));
    const car = await makeCar(null);
    const submitted = await call("POST", `/cars/${car.id}/submit`);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect((await call("POST", `/cars/${car.id}/review`, 1, { decision: "accept" })).status).toBe(403);
    expect((await call("POST", `/cars/${car.id}/review`, 6, { decision: "accept" })).body.status).toBe("Closed");
    const missing = await makeCar(null, otherDepartment);
    const rejected = await call("POST", `/cars/${missing.id}/submit`);
    expect(rejected.status).toBe(409); expect(rejected.body.error).toMatch(/No CAR approvers/);
    expect((await call("PUT", `/cars/${missing.id}`, 0, { ...response, saveAndSubmit: true })).status).toBe(409);
    const [stored] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, missing.id));
    expect(stored!.workflowState).toBe("draft");
    expect(JSON.parse(stored!.effectivenessNotes!).carNumber).toBeUndefined();
  });
  it("preserves legacy pending decisions and closed records; legacy resubmissions adopt configured levels", async () => {
    const legacy = await makeCar();
    await db.update(correctiveActionReports).set({ workflowState: "submitted" }).where(eq(correctiveActionReports.id, legacy.id));
    expect((await call("POST", `/cars/${legacy.id}/review`, 1, { decision: "accept" })).status).toBe(403);
    const closed = await call("POST", `/cars/${legacy.id}/review`, 7, { decision: "accept" });
    expect(closed.body.status).toBe("Closed");
    expect(closed.body.approval.status).toBe("Not submitted");
    const [snapshot] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, legacy.id));
    expect((await call("POST", `/cars/${legacy.id}/review`, 7, { decision: "query", comments: "Cannot reopen" })).status).toBe(409);
    const [after] = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, legacy.id));
    expect(after).toEqual(snapshot);
    const returned = await makeCar();
    await db.update(correctiveActionReports).set({ workflowState: "submitted" }).where(eq(correctiveActionReports.id, returned.id));
    expect((await call("POST", `/cars/${returned.id}/review`, 7, { decision: "query", comments: "Legacy query" })).status).toBe(200);
    expect((await call("POST", `/cars/${returned.id}/submit`)).body.approval.pendingLevel).toBe(1);
    expect((await call("POST", `/cars/${returned.id}/review`, 7, { decision: "accept" })).status).toBe(403);
  });
});
