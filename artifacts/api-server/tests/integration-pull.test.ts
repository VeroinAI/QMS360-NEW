import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  connectorFieldMappings, db, importTemplates, integrationConnectors, organizations,
  platformRoles, projects, syncJobs, users,
} from "@workspace/db";
import integrationsRouter from "../src/routes/integrations";
import { issueToken } from "../src/lib/auth";
import { isPrivateOrReservedIp } from "../src/lib/source-sync";

// Integration Cockpit: source-API connectors (test/pull with field mappings),
// Excel import templates (defaults, copy/edit/delete) and file-drop imports.

let app: Express;
let server: Server;
let baseUrl: string;
let source: Server;
let sourceBase: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgId: string;
let admin: { id: string; token: string };
let member: { id: string; token: string };

// Mutable fake "ERP" payloads so tests can change source data between pulls.
const erp = {
  projects: [
    { proj_code: "P-100", proj_name: "Tower A", town: "Riyadh", ext_ref: "ERP-1", state: "Active" },
    { proj_code: "P-200", proj_name: "Tower B", town: "Jeddah", state: "Active" },
  ] as Array<Record<string, string>>,
  users: [
    { mail: "alice@example.test", name: "Alice Source", dept: "Quality", uname: "alice.s" },
    { mail: "not-an-email", name: "Broken Row" },
  ] as Array<Record<string, string>>,
};

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; raw?: Buffer } = {},
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.raw ? { "content-type": "application/octet-stream" } : { "content-type": "application/json" }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json };
}

beforeAll(async () => {
  // The fake source system runs on loopback — allowlist it like a deployment
  // would for an internal ERP (private hosts are rejected by default).
  process.env.SOURCE_SYNC_ALLOWED_HOSTS = "127.0.0.1";
  // Fake source system: requires the configured API key header.
  const sourceApp = express();
  sourceApp.use((req, res, next) => {
    if (req.headers["x-api-key"] !== "sekret") { res.status(401).json({ error: "bad key" }); return; }
    next();
  });
  sourceApp.get("/erp/projects", (_req, res) => res.json({ data: { items: erp.projects } }));
  sourceApp.get("/erp/users", (_req, res) => res.json(erp.users));
  sourceApp.get("/erp/redirect", (_req, res) => res.redirect("/erp/projects"));
  await new Promise<void>((resolve) => { source = sourceApp.listen(0, "127.0.0.1", () => resolve()); });
  const sourceAddress = source.address();
  if (typeof sourceAddress === "string" || !sourceAddress) throw new Error("Failed to bind source server");
  sourceBase = `http://127.0.0.1:${sourceAddress.port}`;

  app = express();
  app.use(express.json());
  app.use("/api", integrationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [org] = await db.insert(organizations).values({ name: `Cockpit Org ${suffix}`, code: `CK${suffix}` }).returning();
  orgId = org!.id;
  const [role] = await db.insert(platformRoles).values({ organizationId: orgId, name: "Org Admin", isSystem: true }).returning();
  const [adminRow] = await db.insert(users).values({
    organizationId: orgId, email: `admin.${suffix}@example.test`, username: `admin.${suffix}`,
    fullName: "Cockpit Admin", platformRoleId: role!.id,
  }).returning();
  const [memberRow] = await db.insert(users).values({
    organizationId: orgId, email: `member.${suffix}@example.test`, username: `member.${suffix}`, fullName: "Cockpit Member",
  }).returning();
  admin = { id: adminRow!.id, token: issueToken(adminRow!) };
  member = { id: memberRow!.id, token: issueToken(memberRow!) };
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => source.close(resolve));
  await db.delete(syncJobs).where(eq(syncJobs.organizationId, orgId));
  await db.delete(connectorFieldMappings).where(eq(connectorFieldMappings.organizationId, orgId));
  await db.delete(importTemplates).where(eq(importTemplates.organizationId, orgId));
  await db.delete(integrationConnectors).where(eq(integrationConnectors.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(projects).where(eq(projects.organizationId, orgId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

async function createConnector() {
  const res = await api("POST", "/integrations/connectors", {
    token: admin.token,
    body: {
      name: `Fake ERP ${suffix}`, family: "source_api", enabled: true,
      config: {
        baseUrl: sourceBase, authType: "api_key", apiKey: "sekret", apiKeyHeader: "x-api-key",
        direction: "pull",
        endpoints: {
          projects: { path: "/erp/projects", rootPath: "data.items" },
          users: { path: "/erp/users" },
        },
      },
    },
  });
  expect(res.status).toBe(201);
  return res.json;
}

describe("SSRF IP classifier", () => {
  it("rejects private/reserved addresses in every encoding and allows global unicast", () => {
    const blocked = [
      "127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.9", "172.31.255.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "999.1.1.1", "not-an-ip",
      "::1", "::", "fc00::1", "fd12::9", "fe80::1", "feb1::1", "ff02::1", "2001:db8::1", "100::1",
      // IPv4-mapped/compatible in dotted AND hex-group encodings:
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:0A00:0001", "::ffff:0a0a:0a0a", "::7f00:1", "::a9fe:a9fe",
    ];
    for (const ip of blocked) expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    const allowed = ["8.8.8.8", "1.1.1.1", "::ffff:8.8.8.8", "::ffff:0808:0808", "2606:4700:4700::1111", "64:ff9b::8.8.8.8"];
    for (const ip of allowed) expect(isPrivateOrReservedIp(ip), ip).toBe(false);
  });
});

describe("source API connectors", () => {
  it("creates a connector with secrets masked, tests it, and pulls projects via mappings", async () => {
    const connector = await createConnector();
    expect(connector.family).toBe("source_api");
    expect(connector.config.apiKey).toBe("********");
    expect(connector.config.baseUrl).toBe(sourceBase);

    const test = await api("POST", `/integrations/connectors/${connector.id}/test`, { token: admin.token });
    expect(test.json).toMatchObject({ ok: true, sampleCount: 2 });

    // Pull before mappings exist → explicit 422.
    const early = await api("POST", `/integrations/connectors/${connector.id}/pull`, { token: admin.token, body: { entity: "projects" } });
    expect(early.status).toBe(422);

    const mapped = await api("PUT", `/integrations/connectors/${connector.id}/field-mappings`, {
      token: admin.token,
      body: {
        entity: "projects", active: true,
        mappings: [
          { sourceField: "proj_code", targetField: "code" },
          { sourceField: "proj_name", targetField: "name" },
          { sourceField: "town", targetField: "location" },
          { sourceField: "ext_ref", targetField: "externalId" },
          { sourceField: "state", targetField: "status" },
        ],
      },
    });
    expect(mapped.status).toBe(200);

    const pull = await api("POST", `/integrations/connectors/${connector.id}/pull`, { token: admin.token, body: { entity: "projects" } });
    expect(pull.status).toBe(200);
    expect(pull.json).toMatchObject({ status: "succeeded", sourceCount: 2, targetCount: 2, errorCount: 0 });

    // Re-pull with changed source data updates in place (no duplicates):
    // a closed project becomes inactive, and a source row that drops an
    // optional value must NOT erase the stored one.
    erp.projects[0]!.proj_name = "Tower A — North";
    erp.projects[0]!.state = "Closed";
    delete erp.projects[1]!.town;
    const again = await api("POST", `/integrations/connectors/${connector.id}/pull`, { token: admin.token, body: { entity: "projects" } });
    expect(again.json.targetCount).toBe(2);
    const rows = await db.select().from(projects).where(eq(projects.organizationId, orgId));
    expect(rows.length).toBe(2);
    expect(rows.find((p) => p.code === "P-100")).toMatchObject({ name: "Tower A — North", location: "Riyadh", externalId: "ERP-1", source: "api", status: "inactive" });
    expect(rows.find((p) => p.code === "P-200")).toMatchObject({ location: "Jeddah", status: "active" });

    // The run is recorded as a sync job with summary counts.
    const jobs = await api("GET", "/integrations/sync-jobs", { token: admin.token });
    const pullJob = jobs.json.items.find((job: any) => job.connectorId === connector.id);
    expect(pullJob).toMatchObject({ status: "succeeded", sourceCount: 2, targetCount: 2 });

    // Connector list surfaces the last successful sync time.
    const list = await api("GET", "/integrations/connectors", { token: admin.token });
    expect(list.json.items.find((c: any) => c.id === connector.id).lastSuccessfulSyncAt).toBeTruthy();
  });

  it("pulls users with a custom.* mapping into custom fields, collecting row errors", async () => {
    const connector = await createConnector();
    const mapped = await api("PUT", `/integrations/connectors/${connector.id}/field-mappings`, {
      token: admin.token,
      body: {
        entity: "users", active: true,
        mappings: [
          { sourceField: "mail", targetField: "email" },
          { sourceField: "name", targetField: "fullName" },
          { sourceField: "uname", targetField: "username" },
          { sourceField: "dept", targetField: "custom.department" },
        ],
      },
    });
    expect(mapped.status).toBe(200);
    const pull = await api("POST", `/integrations/connectors/${connector.id}/pull`, { token: admin.token, body: { entity: "users" } });
    expect(pull.json).toMatchObject({ status: "succeeded", sourceCount: 2, targetCount: 1, errorCount: 1 });
    expect(pull.json.errors[0].message).toContain("email");
    const [alice] = await db.select().from(users).where(eq(users.email, "alice@example.test"));
    expect(alice).toMatchObject({ fullName: "Alice Source", username: "alice.s", authSource: "api" });
    expect(alice!.customFields).toMatchObject({ department: "Quality" });

    // Re-pull updates name and username in place.
    erp.users[0]!.name = "Alice Updated";
    erp.users[0]!.uname = "alice.s2";
    const repull = await api("POST", `/integrations/connectors/${connector.id}/pull`, { token: admin.token, body: { entity: "users" } });
    expect(repull.json.targetCount).toBe(1);
    const [updated] = await db.select().from(users).where(eq(users.email, "alice@example.test"));
    expect(updated).toMatchObject({ fullName: "Alice Updated", username: "alice.s2" });
  });

  it("rejects SSRF attempts: absolute endpoint paths, non-allowlisted private hosts, redirects", async () => {
    // Absolute endpoint path must never override the base host.
    const absolute = await api("POST", "/integrations/connectors", {
      token: admin.token,
      body: {
        name: `SSRF absolute ${suffix}`, family: "source_api", enabled: true,
        config: { baseUrl: sourceBase, authType: "none", endpoints: { projects: { path: "http://169.254.169.254/latest/meta-data" } } },
      },
    });
    const absTest = await api("POST", `/integrations/connectors/${absolute.json.id}/test`, { token: admin.token });
    expect(absTest.json.ok).toBe(false);
    expect(absTest.json.message).toContain("relative");

    // Private-resolving host that is NOT on the allowlist (localhost is not
    // allowlisted; 127.0.0.1 is) must be rejected before any request.
    const sourceAddress = source.address();
    const port = typeof sourceAddress === "object" && sourceAddress ? sourceAddress.port : 0;
    const privateHost = await api("POST", "/integrations/connectors", {
      token: admin.token,
      body: {
        name: `SSRF private ${suffix}`, family: "source_api", enabled: true,
        config: { baseUrl: `http://localhost:${port}`, authType: "none", endpoints: { projects: { path: "/erp/projects" } } },
      },
    });
    const privTest = await api("POST", `/integrations/connectors/${privateHost.json.id}/test`, { token: admin.token });
    expect(privTest.json.ok).toBe(false);
    expect(privTest.json.message).toContain("private/reserved");

    // Redirects are never followed on credentialled pulls (key included so the
    // request reaches the redirecting endpoint past the fake ERP's auth gate).
    const redirect = await api("POST", "/integrations/connectors", {
      token: admin.token,
      body: {
        name: `SSRF redirect ${suffix}`, family: "source_api", enabled: true,
        config: { baseUrl: sourceBase, authType: "api_key", apiKey: "sekret", endpoints: { projects: { path: "/erp/redirect" } } },
      },
    });
    const redirTest = await api("POST", `/integrations/connectors/${redirect.json.id}/test`, { token: admin.token });
    expect(redirTest.json.ok).toBe(false);
    expect(redirTest.json.message).toContain("redirect");
  });

  it("rejects pull and connector creation for non-admins", async () => {
    const create = await api("POST", "/integrations/connectors", { token: member.token, body: { name: "x", family: "source_api", enabled: true } });
    expect(create.status).toBe(403);
    const connector = await createConnector();
    const pull = await api("POST", `/integrations/connectors/${connector.id}/pull`, { token: member.token, body: { entity: "projects" } });
    expect(pull.status).toBe(403);
  });
});

describe("Excel import templates and file drop", () => {
  it("seeds default templates, allows copies, protects defaults from edit/delete", async () => {
    const list = await api("GET", "/integrations/import-templates?entity=projects", { token: admin.token });
    expect(list.status).toBe(200);
    const defaults = list.json.filter((t: any) => t.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].columns.map((c: any) => c.field)).toContain("code");

    const copy = await api("POST", "/integrations/import-templates", {
      token: admin.token,
      body: { entity: "projects", name: "ERP extract", columns: defaults[0].columns },
    });
    expect(copy.status).toBe(201);
    expect(copy.json.isDefault).toBe(false);

    const editDefault = await api("PUT", `/integrations/import-templates/${defaults[0].id}`, { token: admin.token, body: { entity: "projects", name: "x", columns: defaults[0].columns } });
    expect(editDefault.status).toBe(422);
    const deleteDefault = await api("DELETE", `/integrations/import-templates/${defaults[0].id}`, { token: admin.token });
    expect(deleteDefault.status).toBe(422);

    // Invalid column sets are rejected explicitly.
    const invalid = await api("POST", "/integrations/import-templates", {
      token: admin.token,
      body: { entity: "projects", name: "broken", columns: [{ header: "X", field: "name", required: false }] },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.json.error).toContain("Required fields");
  });

  it("imports a workbook via a custom template with an added custom field", async () => {
    // Admin copies the default users template and adds a brand-new field.
    const defaults = (await api("GET", "/integrations/import-templates?entity=users", { token: admin.token })).json;
    const base = defaults.find((t: any) => t.isDefault);
    const created = await api("POST", "/integrations/import-templates", {
      token: admin.token,
      body: {
        entity: "users", name: "HR extract",
        columns: [
          { header: "Email", field: "email", required: true },
          { header: "Full Name", field: "fullName", required: true },
          { header: "Department", field: "custom.department", required: false },
        ],
      },
    });
    expect(created.status).toBe(201);

    // Download produces a real workbook with only the template headers (no
    // hint rows that would round-trip as bogus data on import).
    const download = await api("GET", `/integrations/import-templates/${created.json.id}/download`, { token: admin.token });
    expect(download.status).toBe(200);
    const workbook = XLSX.read(Buffer.from(download.json.contentBase64, "base64"), { type: "buffer" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1 });
    expect(grid).toEqual([["Email", "Full Name", "Department"]]);

    // Fill the DOWNLOADED workbook (the real user workflow) and import it:
    // one good row, one row missing the required email.
    XLSX.utils.sheet_add_aoa(workbook.Sheets[workbook.SheetNames[0]!], [
      ["bob@example.test", "Bob Import", "Operations"],
      ["", "No Email", "Nowhere"],
    ], { origin: -1 });
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const imported = await api("POST", `/integrations/import-templates/${created.json.id}/import`, { token: admin.token, raw: buffer });
    expect(imported.status).toBe(200);
    expect(imported.json).toMatchObject({ status: "succeeded", sourceCount: 2, targetCount: 1, errorCount: 1 });

    const [bob] = await db.select().from(users).where(eq(users.email, "bob@example.test"));
    expect(bob).toMatchObject({ fullName: "Bob Import", authSource: "excel" });
    expect(bob!.customFields).toMatchObject({ department: "Operations" });

    // The import is recorded as a sync job attributed to the Excel channel.
    const jobs = await api("GET", "/integrations/sync-jobs", { token: admin.token });
    expect(jobs.json.items.some((job: any) => job.connectorId === "" && job.status === "succeeded")).toBe(true);

    const removed = await api("DELETE", `/integrations/import-templates/${created.json.id}`, { token: admin.token });
    expect(removed.status).toBe(204);
  });
});
