import { describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { auditPlanActivityLabelsQuery } from "./audit-plan-activity-labels";

describe("Audit Plan report activity master lookup", () => {
  it("matches title-case Activities groups using a case-insensitive group code", () => {
    const query = auditPlanActivityLabelsQuery(db, "11111111-1111-4111-8111-111111111111").toSQL();
    expect(query.sql).toContain('lower("shared"."master_data_groups"."code")');
    expect(query.params).toContain("activities");
  });
  it("scopes both masters to the requesting organization and excludes deleted entries", () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const query = auditPlanActivityLabelsQuery(db, organizationId).toSQL();
    expect(query.params.filter(value => value === organizationId)).toHaveLength(2);
    expect(query.sql).toContain('"master_data_groups"."organization_id"');
    expect(query.sql).toContain('"master_data_values"."organization_id"');
    expect(query.sql).toContain('"master_data_groups"."deleted_at" is null');
    expect(query.sql).toContain('"master_data_values"."deleted_at" is null');
  });
  it("does not exclude inactive master labels needed by historical reports", () => {
    const query = auditPlanActivityLabelsQuery(db, "11111111-1111-4111-8111-111111111111").toSQL();
    expect(query.sql).not.toContain('"active"');
    expect(query.sql).not.toContain('"status"');
  });
});
