import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListDronaProjectMasterResponse, UpdateDronaProjectCostCentreResponse } from "@workspace/api-zod";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute } }));

import { readDronaProjectMaster, saveDronaProjectCostCentre, type ProjectMasterInput } from "./project-master";

const input: ProjectMasterInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  page: 1, limit: 20,
  scope: { unrestricted: true, projectIds: [] },
};
const projectId = "00000000-0000-4000-8000-000000000002";
const iso = "2026-10-09T06:30:00.000Z";

function mockList(createdAt: unknown, updatedAt: unknown, linkedAt: unknown = iso, available = true) {
  execute.mockResolvedValueOnce({ rows: [{ available }] })
    .mockResolvedValueOnce({ rows: [{
      id: projectId, code: "P001", name: "Project", location: null, status: "active",
      costCentre: "CC01", recordSource: "drona", externalId: "123", businessUnit: null,
      createdAt, updatedAt,
      dronaLinks: available ? [{ externalProjectId: "123", environment: "test", linkedAt }] : [],
    }] })
    .mockResolvedValueOnce({ rows: [{ total: 1 }] });
}

beforeEach(() => execute.mockReset());

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
