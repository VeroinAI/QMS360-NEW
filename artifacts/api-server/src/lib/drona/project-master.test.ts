import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListDronaProjectMasterResponse, UpdateDronaProjectCostCentreResponse, UpdateProjectAdditionalDataBody, UpdateProjectAdditionalDataResponse } from "@workspace/api-zod";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute } }));

import { readDronaProjectMaster, saveDronaProjectCostCentre, saveProjectAdditionalData, type ProjectMasterInput } from "./project-master";

const input: ProjectMasterInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  page: 1, limit: 20,
  scope: { unrestricted: true, projectIds: [] },
};
const projectId = "00000000-0000-4000-8000-000000000002";
const iso = "2026-10-09T06:30:00.000Z";

function mockList(createdAt: unknown, updatedAt: unknown, linkedAt: unknown = iso, available = true, source = "drona") {
  execute.mockResolvedValueOnce({ rows: [{ available }] })
    .mockResolvedValueOnce({ rows: [{
      id: projectId, code: "P001", name: "Project", location: null, status: "active",
      costCentre: "CC01", recordSource: source, externalId: source === "drona" ? "123" : null, businessUnit: null,
      createdAt, updatedAt,
      dronaLinks: available ? [{ externalProjectId: "123", environment: "test", linkedAt }] : [],
    }] })
    .mockResolvedValueOnce({ rows: [{ total: 1 }] });
}

beforeEach(() => execute.mockReset());

describe("Project Additional Data contacts", () => {
  const additionalData = { client: null, contractor: null, contractProjectNumber: null, contractSigned: null, contractPeriod: null, tcc: null, pac: null, fac: null };
  const payload = (email: string | null, phone: string | null) => ({ costCentre: "CC01", additionalData: { ...additionalData, email, phone } });
  it.each(["not-an-email", "a@@example.com", "a@invalid", "a..b@example.com", "a@-example.com"])("rejects an invalid email (%s)", email => {
    expect(UpdateProjectAdditionalDataBody.safeParse(payload(email, null)).success).toBe(false);
  });
  it.each(["9876543210", "+091 9876543210", "+1 abcdefgh", "+1", "+1234567890123456"])("rejects an invalid international phone (%s)", phone => {
    expect(UpdateProjectAdditionalDataBody.safeParse(payload(null, phone)).success).toBe(false);
  });
  it("accepts optional, empty-by-null contacts and older clients omitting the new fields", () => {
    expect(UpdateProjectAdditionalDataBody.safeParse(payload(null, null)).success).toBe(true);
    expect(UpdateProjectAdditionalDataBody.safeParse({ costCentre: null, additionalData }).success).toBe(true);
  });
  it("persists contacts in existing scoped metadata and returns them for reopening", async () => {
    const data = payload("quality+project@example.com", "+91 9876543210");
    execute.mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({ rows: [{ id: projectId, costCentre: data.costCentre, additionalData: data.additionalData, updatedAt: iso }] });
    const result = await saveProjectAdditionalData(input, projectId, data);
    expect(result?.additionalData).toMatchObject({ email: data.additionalData.email, phone: data.additionalData.phone });
    expect(UpdateProjectAdditionalDataResponse.safeParse(result).success).toBe(true);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[1][0]);
    expect(query.params).toContain(JSON.stringify(data.additionalData));
    expect(query.params).toContain(input.organizationId);
    expect(query.sql).toContain("qmsAdditionalData");
    expect(query.sql).toContain("p.deleted_at IS NULL");
  });
  it("returns null contacts for projects that predate these fields", async () => {
    mockList(iso, iso);
    expect((await readDronaProjectMaster(input)).items[0].additionalData).toMatchObject({ email: null, phone: null });
  });
});

describe("Project Master timestamp serialization", () => {
  it.each([
    ["Date objects", new Date(iso), new Date(iso)],
    ["ISO strings", iso, iso],
    ["PostgreSQL timestamp strings", "2026-10-09 12:00:00+05:30", "2026-10-09 06:30:00+00"],
    ["mixed representations", new Date(iso), iso],
  ])("lists projects with %s", async (_label, createdAt, updatedAt) => {
    mockList(createdAt, updatedAt, "2026-10-09T12:00:00+05:30");
    const result = await readDronaProjectMaster(input);
    expect(result.items[0]).toMatchObject({
      id: projectId, costCentre: "CC01", createdAt: iso, updatedAt: iso,
      dronaLinks: [{ externalProjectId: "123", environment: "test", linkedAt: iso }],
    });
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(ListDronaProjectMasterResponse.safeParse(result).success).toBe(true);
  });

  it("supports deployments without link metadata", async () => {
    mockList(iso, iso, iso, false);
    const result = await readDronaProjectMaster(input);
    expect(result.linkMetadataAvailable).toBe(false);
    expect(result.items[0].dronaLinks).toEqual([]);
  });

  it("returns an empty list without attempting date conversion", async () => {
    execute.mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });
    expect((await readDronaProjectMaster(input)).items).toEqual([]);
  });

  it.each(["invalid", "", null, undefined, 0])("rejects invalid required dates (%s) rather than fabricating a date", async value => {
    mockList(value, iso);
    await expect(readDronaProjectMaster(input)).rejects.toThrow("Invalid Project Master timestamp: createdAt");
  });

  it("validates linked timestamps too", async () => {
    mockList(iso, iso, "invalid");
    await expect(readDronaProjectMaster(input)).rejects.toThrow("Invalid Project Master timestamp: linkedAt");
  });

  it.each([new Date(iso), "2026-10-09 12:00:00+05:30"])("serializes the cost-center save timestamp (%s)", async updatedAt => {
    execute.mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [{ id: projectId, costCentre: "CC02", updatedAt }] });
    const result = await saveDronaProjectCostCentre(input, projectId, "CC02");
    expect(result).toEqual({ id: projectId, costCentre: "CC02", updatedAt: iso });
    expect(UpdateDronaProjectCostCentreResponse.safeParse(result).success).toBe(true);
  });

  it("preserves not-found handling for cost-center saves", async () => {
    execute.mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [] });
    expect(await saveDronaProjectCostCentre(input, projectId, null)).toBeNull();
  });
});

describe("local and Drona Project Master access", () => {
  const dialect = new PgDialect();
  const statements = () => execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));

  it.each([false, true])("includes local projects regardless of Drona metadata availability (%s)", async available => {
    mockList(iso, iso, iso, available, "local");
    const result = await readDronaProjectMaster({ ...input, search: "Alpha" });
    expect(result.items[0].recordSource).toBe("local");
    expect(result.linkMetadataAvailable).toBe(available);
    expect(ListDronaProjectMasterResponse.safeParse(result).success).toBe(true);
    for (const query of statements().slice(1)) {
      const where = query.sql.slice(query.sql.lastIndexOf("WHERE p.organization_id"));
      expect(where).not.toMatch(/AND\s*\(?p\.source\s*=\s*'drona'/);
      expect(query.params).toContain(input.organizationId);
      expect(query.params).toContain("alpha");
      expect(where).toContain("p.deleted_at IS NULL");
    }
  });

  it("retains restricted project IDs for list and count queries", async () => {
    mockList(iso, iso, iso, false, "local");
    await readDronaProjectMaster({ ...input, scope: { unrestricted: false, projectIds: [projectId] } });
    for (const query of statements().slice(1)) {
      expect(query.sql).toContain("AND p.id IN");
      expect(query.params).toContain(projectId);
      expect(query.params).toContain(input.organizationId);
    }
  });

  it("empty project scope denies all instead of broadening access", async () => {
    execute.mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });
    await readDronaProjectMaster({ ...input, scope: { unrestricted: false, projectIds: [] } });
    for (const query of statements().slice(1)) expect(query.sql).toContain("AND false");
  });

  it("writes Cost Center for local records without touching their source or unrelated metadata", async () => {
    execute.mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({ rows: [{ id: projectId, costCentre: "CC-LOCAL", updatedAt: iso }] });
    expect(await saveDronaProjectCostCentre({ ...input, scope: { unrestricted: false, projectIds: [projectId] } }, projectId, "CC-LOCAL"))
      .toMatchObject({ id: projectId, costCentre: "CC-LOCAL" });
    const query = statements()[1];
    expect(query.sql).not.toContain("p.source = 'drona'");
    expect(query.sql).toContain("(p.custom_fields - 'cost_centre') || jsonb_build_object");
    expect(query.sql).toContain("AND p.id IN");
    expect(query.sql).toContain("p.deleted_at IS NULL");
    expect(query.sql).not.toMatch(/SET\s+(?:source|name|code)\s*=/);
    expect(query.params).toEqual(expect.arrayContaining([input.organizationId, projectId, "CC-LOCAL"]));
  });

  it("Cost Center writes remain denied for empty scopes", async () => {
    execute.mockResolvedValueOnce({ rows: [{ available: false }] }).mockResolvedValueOnce({ rows: [] });
    expect(await saveDronaProjectCostCentre({ ...input, scope: { unrestricted: false, projectIds: [] } }, projectId, null)).toBeNull();
    expect(statements()[1].sql).toContain("AND false");
  });

  it("Drona link display still uses the selected environment without filtering out local projects", async () => {
    mockList(iso, iso);
    await readDronaProjectMaster({ ...input, environment: "dev" });
    const query = statements()[1];
    expect(query.sql).toContain("l.environment_key =");
    expect(query.params).toContain("dev");
    expect(query.sql.slice(query.sql.lastIndexOf("WHERE p.organization_id"))).not.toContain("p.source = 'drona'");
  });
});
