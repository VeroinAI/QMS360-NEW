import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { db, organizations, users, platformRoles, projects, audits, auditPlans, auditSchedules, auditFindings,
  correctiveActionReports, auditAuditLogEntries, auditWorkspaceRoles, auditWorkspaceRolePermissions,
  auditUserWorkspaceRoles, auditPermissions } from "@workspace/db";
import app from "../src/app";
import { issueToken } from "../src/lib/auth";
import { carWordReportData } from "../src/lib/car-word-report-data";
import { CAR_WORD_MIME } from "../src/lib/car-word-report";
import { captureCarSignature } from "../src/lib/car-signature-evidence";

const storage = vi.hoisted(() => ({ get: vi.fn(), store: vi.fn(), objects: new Map<string, Uint8Array>() }));
vi.mock("../src/lib/objectStorage", () => ({ getObject: storage.get, storeObject: storage.store }));
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const suffix = randomUUID().slice(0, 8);
let server: Server, base: string, org: string, foreign: string, project: string, token: string, foreignToken: string;
let originator: string, taker: string, lead: string, png: Buffer;

async function fixture() {
  const [schedule] = await db.insert(auditSchedules).values({ organizationId: org, projectId: project, title: "CAR mapping audit", year: 2026 }).returning();
  const [plan] = await db.insert(auditPlans).values({ organizationId: org, projectId: project, auditScheduleId: schedule!.id,
    status: JSON.stringify({ leadAuditorId: lead }) }).returning();
  const item = { id: randomUUID(), auditFinding: "Major NC", actionTakerId: taker, description: "Actual finding", findingDate: "2026-10-20" };
  const [audit] = await db.insert(audits).values({ organizationId: org, projectId: project, auditPlanId: plan!.id,
    referenceNumber: `CAR-${randomUUID()}`, checklistState: [item] }).returning();
  const [finding] = await db.insert(auditFindings).values({ organizationId: org, auditId: audit!.id, classification: "Major NC",
    createdAt: new Date("2026-10-10T00:00:00Z"), evidence: { sourceChecklistItemId: item.id } }).returning();
  const [car] = await db.insert(correctiveActionReports).values({ organizationId: org, auditFindingId: finding!.id,
    ownerId: lead, responsibleDepartment: "Quality", workflowState: "draft", dueDate: "2026-10-22",
    createdAt: new Date("2026-10-11T00:00:00Z"), effectivenessNotes: JSON.stringify({ sourceChecklistItemId: item.id }) }).returning();
  await db.insert(auditAuditLogEntries).values([
    { organizationId: org, entityType: "audit", entityId: audit!.id, action: "add_finding_item", actorId: originator,
      createdAt: new Date("2026-10-01T11:00:00Z"), before: { checklistState: [] }, after: { checklistState: [item] } },
    { organizationId: org, entityType: "audit", entityId: audit!.id, action: "edit_checklist_item", actorId: lead,
      createdAt: new Date("2026-10-12T11:00:00Z"), before: { checklistState: [item] }, after: { checklistState: [{ ...item, description: "Edited" }] } },
    ...[["submit", "2026-10-14"], ["submit", "2026-10-16"], ["update", "2026-10-17"], ["accept", "2026-10-18"]].map(([action, date]) => ({
      organizationId: org, entityType: "corrective_action_report", entityId: car!.id, action: action!,
      createdAt: new Date(`${date}T11:00:00Z`), actorId: taker,
    })),
  ]);
  return { auditId: audit!.id, itemId: item.id, carId: car!.id, findingId: finding!.id, planId: plan!.id };
}
const req = () => ({ currentUser: { id: originator, organizationId: org }, permissionAdminBypass: true,
  log: { warn: vi.fn() } } as any);
async function download(input: { auditId: string; itemId: string; carId?: string }, auth = token) {
  return fetch(`${base}/api/audit/car-register/report.docx?${new URLSearchParams(input)}`, { headers: { authorization: `Bearer ${auth}` } });
}
function textDocument(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const doc = new DOMParser().parseFromString(strFromU8(files["word/document.xml"]!), "application/xml");
  return { files, doc, text: Array.from(doc.getElementsByTagNameNS(W, "t")).map(n => n.textContent).join("\n") };
}

beforeAll(async () => {
  png = await sharp({ create: { width: 300, height: 65, channels: 4, background: "#18358a" } }).png().toBuffer();
  storage.get.mockImplementation(async (path: string) => {
    if (path.includes("unavailable")) throw new Error("Missing object");
    if (path.includes("/car-signature-evidence/")) {
      const bytes = storage.objects.get(path);
      if (!bytes) throw new Error("Missing object");
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    }
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
  });
  storage.store.mockImplementation(async (path: string, bytes: Buffer) => {
    storage.objects.set(`/test/${path}`, new Uint8Array(bytes));
    return `/test/${path}`;
  });
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const isForeign of [false, true]) {
    const [organization] = await db.insert(organizations).values({ name: `CAR Word ${suffix}-${isForeign}`, code: `CW${suffix}${isForeign}` }).returning();
    const id = organization!.id;
    if (isForeign) foreign = id; else org = id;
    const [role] = await db.insert(platformRoles).values({ organizationId: id, name: "Org Admin", isSystem: true }).returning();
    const people = await db.insert(users).values((isForeign ? ["Foreign"] : ["Original creator", "Action Taker", "New Plan Lead"]).map((fullName, i) => ({
      organizationId: id, platformRoleId: role!.id, fullName, username: `cw-${suffix}-${isForeign}-${i}`,
      email: `cw-${suffix}-${isForeign}-${i}@example.test`, signaturePath: `gcs:/test/signature-${i}.png`,
    }))).returning();
    if (isForeign) foreignToken = issueToken(people[0]!);
    else { [originator, taker, lead] = people.map(p => p.id); token = issueToken(people[0]!); }
  }
  const [p] = await db.insert(projects).values({ organizationId: org, name: "CAR Word Project", code: `CW${suffix}` }).returning(); project = p!.id;
}, 30000);
afterAll(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()));
  for (const id of [org, foreign].filter(Boolean)) {
    for (const table of [auditAuditLogEntries, correctiveActionReports, auditFindings, audits, auditPlans, auditSchedules,
      auditWorkspaceRolePermissions, auditUserWorkspaceRoles, auditWorkspaceRoles, auditPermissions, users, platformRoles, projects]) {
      await db.delete(table).where(eq(table.organizationId, id));
    }
    await db.delete(organizations).where(eq(organizations.id, id));
  }
});

describe("Read-only CAR Word endpoint and mapper", () => {
  it("keeps original creation attribution, Action Taker signatures and latest submission despite edits and Plan lead changes", async () => {
    const f = await fixture();
    const originatorEvidence = await captureCarSignature(db, org, f.itemId, originator);
    originatorEvidence.capturedAt = "2026-10-01T11:00:00Z";
    const recipientEvidence = await captureCarSignature(db, org, f.carId, taker);
    await db.update(audits).set({ status: JSON.stringify({ carOriginatorSignatures: { [f.itemId]: originatorEvidence } }) }).where(eq(audits.id, f.auditId));
    await db.update(correctiveActionReports).set({ effectivenessNotes: JSON.stringify({
      sourceChecklistItemId: f.itemId, carRecipientSignature: recipientEvidence,
    }) }).where(eq(correctiveActionReports.id, f.carId));
    const data = await carWordReportData(req(), f);
    expect(data.auditor).toBe("Original creator");
    expect(data.originatorDate).toBe("01/10/2026");
    expect(data.recipient).toBe("Action Taker");
    expect(data.recipientDate).toBe("16/10/2026");
    expect(data.actionDate).toBe("16/10/2026");
    expect(data.originatorSignature).toBeTruthy(); expect(data.recipientSignature).toBeTruthy();
    expect(storage.get).toHaveBeenCalledWith("/test/signature-0.png");
    expect(storage.get).toHaveBeenCalledWith("/test/signature-1.png");
    // Profile replacement/removal must not change any captured signature bytes.
    await db.update(users).set({ signaturePath: "gcs:/test/replacement.png" }).where(eq(users.id, originator));
    await db.update(users).set({ signaturePath: null }).where(eq(users.id, taker));
    storage.get.mockClear();
    const changed = await carWordReportData(req(), f);
    expect(changed.originatorSignature).toEqual(data.originatorSignature);
    expect(changed.recipientSignature).toEqual(data.recipientSignature);
    expect(storage.get.mock.calls.every(([path]) => path.includes("/car-signature-evidence/"))).toBe(true);
    const predicate = and(eq(auditAuditLogEntries.organizationId, org), eq(auditAuditLogEntries.entityId, f.carId));
    const before = await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, f.carId));
    const history = await db.select().from(auditAuditLogEntries).where(predicate);
    for (let i = 0; i < 2; i++) {
      const response = await download(f); expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(CAR_WORD_MIME);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const bytes = new Uint8Array(await response.arrayBuffer()), report = textDocument(bytes);
      expect(report.text).toContain("01/10/2026"); expect(report.text).toContain("16/10/2026");
      expect(report.doc.getElementsByTagNameNS(W, "drawing")).toHaveLength(3);
      // Optional disposable Office-render fixture; never a production artifact.
      if (process.env.CAR_WORD_RENDER_FIXTURE === "1" && i === 0) {
        await mkdir("../../generated-artifacts/car-word", { recursive: true });
        await writeFile("../../generated-artifacts/car-word/representative.docx", bytes);
      }
    }
    expect(await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.id, f.carId))).toEqual(before);
    expect(await db.select().from(auditAuditLogEntries).where(predicate)).toEqual(history);
    storage.objects.delete(recipientEvidence.path!.slice(4));
    const missing = await carWordReportData(req(), f);
    expect(missing.recipientSignature).toBeUndefined();
    const missingReport = textDocument(new Uint8Array(await (await download(f)).arrayBuffer()));
    expect(missingReport.text).toContain("To be mapped");
    expect(missingReport.doc.getElementsByTagNameNS(W, "drawing")).toHaveLength(1);
    await db.update(users).set({ signaturePath: "gcs:/test/signature-0.png" }).where(eq(users.id, originator));
    await db.update(users).set({ signaturePath: "gcs:/test/signature-1.png" }).where(eq(users.id, taker));
  });
  it("never backfills historical signature gaps from today's profiles", async () => {
    const f = await fixture();
    storage.get.mockClear(); storage.store.mockClear();
    const data = await carWordReportData(req(), f);
    expect(data.originatorSignature).toBeUndefined();
    expect(data.recipientSignature).toBeUndefined();
    const response = await download(f);
    const report = textDocument(new Uint8Array(await response.arrayBuffer()));
    expect(report.doc.getElementsByTagNameNS(W, "drawing")).toHaveLength(0);
    expect(report.text).toContain("To be mapped");
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.store).not.toHaveBeenCalled();
  });
  it("uses approved extensions and only final approval; missing closed history stays unmapped", async () => {
    const f = await fixture();
    for (const [workflowState, status, outcome, closedAt, accepted, withinAcd] of [
      ["submitted", "Pending approval", "accept", null, false, false],
      ["rejected", "Sent back", "query", null, false, false],
      ["rejected", "Sent back", "rework", null, false, false],
      ["closed", "Approved", "accept", "2026-10-25T23:59:59Z", true, true],
      ["closed", "Approved", "accept", "2026-10-26T00:00:00Z", true, false],
      ["closed", "Approved", "accept", null, true, null],
    ] as const) {
      await db.update(correctiveActionReports).set({ workflowState, extensionStatus: "approved", extensionDueDate: "2026-10-25",
        effectivenessNotes: JSON.stringify({ sourceChecklistItemId: f.itemId, carApproval: { status, steps: [], index: 0, reviewers: [], submittedAt: "2026-10-19T10:00:00Z" }, reviewOutcome: outcome, closedAt }) })
        .where(eq(correctiveActionReports.id, f.carId));
      const data = await carWordReportData(req(), f);
      expect(data).toMatchObject({ accepted, withinAcd, completed: workflowState === "closed", dueDate: "25/10/2026", recipientDate: "19/10/2026" });
    }
  });
  it("does not substitute a synthetic CAR-linked finding's creation or current lead when original evidence is missing", async () => {
    const f = await fixture();
    await db.delete(auditAuditLogEntries).where(and(eq(auditAuditLogEntries.entityType, "audit"), eq(auditAuditLogEntries.entityId, f.auditId)));
    const data = await carWordReportData(req(), f);
    expect(data.originatorDate).toBeNull(); expect(data.auditor).toBeUndefined(); expect(data.originatorSignature).toBeUndefined();
    await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.entityId, f.carId));
    const missingSubmission = await carWordReportData(req(), f);
    expect(missingSubmission.recipientDate).toBeNull(); expect(missingSubmission.actionDate).toBeNull();
    await db.update(users).set({ signaturePath: "gcs:/test/unavailable.png" }).where(eq(users.id, taker));
    expect((await carWordReportData(req(), f)).recipientSignature).toBeUndefined();
    await db.update(users).set({ signaturePath: "gcs:/test/signature-1.png" }).where(eq(users.id, taker));
  });
  it("uses genuine standalone creation evidence, and never creates a CAR when none exists", async () => {
    const f = await fixture();
    const [finding] = await db.insert(auditFindings).values({ organizationId: org, auditId: f.auditId,
      classification: "Minor NC", createdAt: new Date("2026-09-01T08:00:00Z") }).returning();
    await db.insert(auditAuditLogEntries).values({ organizationId: org, entityType: "audit_finding", entityId: finding!.id,
      action: "create", actorId: originator, createdAt: new Date("2026-09-01T08:00:00Z") });
    const input = { auditId: f.auditId, itemId: finding!.id };
    expect(await carWordReportData(req(), input)).toMatchObject({ auditor: "Original creator", originatorDate: "01/09/2026",
      recipientDate: null, completed: false, accepted: false, withinAcd: false });
    const response = await download(input); expect(response.status).toBe(200);
    expect(textDocument(new Uint8Array(await response.arrayBuffer())).text).toContain("01/09/2026");
    expect(await db.select().from(correctiveActionReports).where(eq(correctiveActionReports.auditFindingId, finding!.id))).toEqual([]);
    await db.delete(auditAuditLogEntries).where(eq(auditAuditLogEntries.entityId, finding!.id));
    const noCreatorHistory = await carWordReportData(req(), input);
    expect(noCreatorHistory.originatorDate).toBe("01/09/2026");
    expect(noCreatorHistory.originatorSignature).toBeUndefined();
  });
  it("isolates organization, record linkage and project scope before signature loading", async () => {
    const f = await fixture(), other = await fixture();
    storage.get.mockClear();
    expect((await download(f, foreignToken)).status).toBe(404);
    expect((await download({ ...f, itemId: other.itemId })).status).toBe(404);
    const employeeRole = await db.insert(platformRoles).values({ organizationId: org, name: "Employee", isSystem: true }).returning();
    await db.update(users).set({ platformRoleId: employeeRole[0]!.id }).where(eq(users.id, lead));
    const [employee] = await db.select().from(users).where(eq(users.id, lead));
    expect((await download(f, issueToken(employee!))).status).toBe(403);
    expect(storage.get).not.toHaveBeenCalled();
  });
});
