import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { connectorFieldMappings, db, integrationConnectors, organizations, platformRoles, users } from "@workspace/db";
import integrationsRouter from "../src/routes/integrations";
import { issueToken } from "../src/lib/auth";

// Route tests for the Integration Cockpit field-mapping workspace. They run
// against the real development database using a throwaway organization so
// validation, tenancy, and replace/activate semantics are locked in.

let app: Express;
let server: Server;
let baseUrl: string;

const suffix = Math.random().toString(36).slice(2, 8);
let orgAId: string;
let orgBId: string;
let adminA: { id: string; organizationId: string; token: string };
let memberA: { id: string; organizationId: string; token: string };
let adminB: { id: string; organizationId: string; token: string };
let connectorAId: string;
let emailConnectorAId: string;
let connectorBId: string;

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: response.status, json };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", integrationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  const [orgA] = await db.insert(organizations).values({ name: `Mapping Test Org A ${suffix}`, code: `MTA${suffix}` }).returning();
  const [orgB] = await db.insert(organizations).values({ name: `Mapping Test Org B ${suffix}`, code: `MTB${suffix}` }).returning();
  orgAId = orgA!.id;
  orgBId = orgB!.id;

  const [roleA] = await db.insert(platformRoles).values({ organizationId: orgAId, name: "Org Admin", isSystem: true }).returning();
  const [roleB] = await db.insert(platformRoles).values({ organizationId: orgBId, name: "Org Admin", isSystem: true }).returning();

  const insertUser = (orgId: string, name: string, platformRoleId?: string) =>
    db.insert(users).values({
      organizationId: orgId,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}@example.test`,
      username: `${name.toLowerCase().replace(/\s+/g, ".")}.${suffix}`,
      fullName: name,
      platformRoleId: platformRoleId ?? null,
    }).returning();

  const [adminRowA] = await insertUser(orgAId, "Admin A", roleA!.id);
  const [memberRowA] = await insertUser(orgAId, "Member A");
  const [adminRowB] = await insertUser(orgBId, "Admin B", roleB!.id);

  adminA = { id: adminRowA!.id, organizationId: orgAId, token: issueToken(adminRowA!) };
  memberA = { id: memberRowA!.id, organizationId: orgAId, token: issueToken(memberRowA!) };
  adminB = { id: adminRowB!.id, organizationId: orgBId, token: issueToken(adminRowB!) };

  const [connectorA] = await db.insert(integrationConnectors).values({ organizationId: orgAId, connectorType: "platform", name: "ERP sync", isEnabled: true }).returning();
  const [emailA] = await db.insert(integrationConnectors).values({ organizationId: orgAId, connectorType: "email", name: "SMTP", isEnabled: true }).returning();
  const [connectorB] = await db.insert(integrationConnectors).values({ organizationId: orgBId, connectorType: "oracle_adw", name: "Warehouse", isEnabled: true }).returning();
  connectorAId = connectorA!.id;
  emailConnectorAId = emailA!.id;
  connectorBId = connectorB!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  const orgIds = [orgAId, orgBId];
  await db.delete(connectorFieldMappings).where(inArray(connectorFieldMappings.organizationId, orgIds));
  await db.delete(integrationConnectors).where(inArray(integrationConnectors.organizationId, orgIds));
  await db.delete(users).where(inArray(users.organizationId, orgIds));
  await db.delete(platformRoles).where(inArray(platformRoles.organizationId, orgIds));
  await db.delete(organizations).where(inArray(organizations.id, orgIds));
});

describe("authentication and authorization", () => {
  it("rejects unauthenticated workspace reads with 401", async () => {
    const res = await api("GET", `/integrations/connectors/${connectorAId}/field-mappings`);
    expect(res.status).toBe(401);
  });

  it("forbids non-admin users from saving mappings with 403", async () => {
    const res = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: memberA.token,
      body: { entity: "projects", active: false, mappings: [] },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for connectors from another organization", async () => {
    const read = await api("GET", `/integrations/connectors/${connectorAId}/field-mappings`, { token: adminB.token });
    expect(read.status).toBe(404);
    const write = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminB.token,
      body: { entity: "projects", active: false, mappings: [{ sourceField: "x", targetField: "name" }] },
    });
    expect(write.status).toBe(404);
  });

  it("returns 404 for a nonexistent connector", async () => {
    const res = await api("GET", `/integrations/connectors/${crypto.randomUUID()}/field-mappings`, { token: adminA.token });
    expect(res.status).toBe(404);
  });

  it("rejects connectors that do not support field mapping with 422", async () => {
    const res = await api("GET", `/integrations/connectors/${emailConnectorAId}/field-mappings`, { token: adminA.token });
    expect(res.status).toBe(422);
  });
});

describe("workspace reads", () => {
  it("returns the entity catalog with required target fields", async () => {
    const res = await api("GET", `/integrations/connectors/${connectorAId}/field-mappings`, { token: memberA.token });
    expect(res.status).toBe(200);
    expect(res.json.connectorId).toBe(connectorAId);
    const entities: string[] = res.json.entities.map((entry: any) => entry.entity);
    expect(entities).toEqual(expect.arrayContaining(["projects", "users"]));
    const projects = res.json.entities.find((entry: any) => entry.entity === "projects");
    expect(projects.targetFields.some((field: any) => field.key === "code" && field.required)).toBe(true);
    expect(Array.isArray(res.json.mappings)).toBe(true);
  });
});

describe("mapping validation", () => {
  it("blocks activation while required target fields are unmapped", async () => {
    const res = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "projects", active: true, mappings: [{ sourceField: "project_name", targetField: "name" }] },
    });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("Project code");
  });

  it("rejects duplicate target fields", async () => {
    const res = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "projects", active: false, mappings: [{ sourceField: "a", targetField: "name" }, { sourceField: "b", targetField: "name" }] },
    });
    expect(res.status).toBe(422);
  });

  it("rejects unknown target fields and unknown entities", async () => {
    const badTarget = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "projects", active: false, mappings: [{ sourceField: "a", targetField: "bogus" }] },
    });
    expect(badTarget.status).toBe(422);
    const badEntity = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "aliens", active: false, mappings: [] },
    });
    expect(badEntity.status).toBe(422);
  });
});

describe("save and activation", () => {
  it("saves an active mapping set and returns it on read", async () => {
    const saved = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "projects", active: true, mappings: [{ sourceField: "project_code", targetField: "code" }, { sourceField: "project_name", targetField: "name" }] },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.mappings).toHaveLength(2);
    expect(saved.json.mappings.every((mapping: any) => mapping.active)).toBe(true);

    const read = await api("GET", `/integrations/connectors/${connectorAId}/field-mappings`, { token: memberA.token });
    expect(read.json.mappings.map((mapping: any) => `${mapping.sourceField}->${mapping.targetField}`).sort())
      .toEqual(["project_code->code", "project_name->name"]);
  });

  it("replaces the previous set for the same entity and bumps the mapping version", async () => {
    const before = await db.select().from(integrationConnectors).where(inArray(integrationConnectors.id, [connectorAId]));
    const replaced = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "projects", active: false, mappings: [{ sourceField: "emp_code", targetField: "code" }, { sourceField: "emp_name", targetField: "name" }] },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.json.mappings).toHaveLength(2);
    expect(replaced.json.mappings.every((mapping: any) => !mapping.active)).toBe(true);
    expect(replaced.json.mappings.map((mapping: any) => mapping.sourceField)).not.toContain("project_code");

    const after = await db.select().from(integrationConnectors).where(inArray(integrationConnectors.id, [connectorAId]));
    expect(after[0]!.fieldMappingVersion).toBe(before[0]!.fieldMappingVersion + 1);
  });

  it("keeps mappings for other entities and other connectors untouched", async () => {
    const employees = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "users", active: true, mappings: [{ sourceField: "full_name", targetField: "fullName" }, { sourceField: "email", targetField: "email" }] },
    });
    expect(employees.status).toBe(200);
    const read = await api("GET", `/integrations/connectors/${connectorAId}/field-mappings`, { token: adminA.token });
    expect(read.json.mappings.filter((mapping: any) => mapping.entity === "projects")).toHaveLength(2);
    expect(read.json.mappings.filter((mapping: any) => mapping.entity === "users")).toHaveLength(2);

    const readB = await api("GET", `/integrations/connectors/${connectorBId}/field-mappings`, { token: adminB.token });
    expect(readB.status).toBe(200);
    expect(readB.json.mappings).toHaveLength(0);
  });

  it("serializes concurrent saves so the live set is never mixed", async () => {
    const body = (prefix: string) => ({ entity: "projects", active: true, mappings: [{ sourceField: `${prefix}_code`, targetField: "code" }, { sourceField: `${prefix}_name`, targetField: "name" }] });
    const [first, second] = await Promise.all([
      api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, { token: adminA.token, body: body("a") }),
      api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, { token: adminA.token, body: body("b") }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const read = await api("GET", `/integrations/connectors/${connectorAId}/field-mappings`, { token: adminA.token });
    const live = read.json.mappings
      .filter((mapping: any) => mapping.entity === "projects")
      .map((mapping: any) => mapping.sourceField)
      .sort()
      .join(",");
    expect(["a_code,a_name", "b_code,b_name"]).toContain(live);
  });

  it("rejects blank source fields", async () => {
    const res = await api("PUT", `/integrations/connectors/${connectorAId}/field-mappings`, {
      token: adminA.token,
      body: { entity: "projects", active: false, mappings: [{ sourceField: "   ", targetField: "name" }] },
    });
    expect(res.status).toBe(422);
  });
});
