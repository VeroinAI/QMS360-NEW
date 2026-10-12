import { describe, expect, it } from "vitest";
import { moveAuditActivitiesMaster } from "./audit-activities-master-scope";

describe("Activities master application correction", () => {
  it("moves the existing master group to Audit without recreating it", () => {
    const query = moveAuditActivitiesMaster().toSQL();
    expect(query.sql).toMatch(/^update "shared"\."master_data_groups" set/);
    expect(query.params).toContain("audit");
    expect(query.sql).not.toContain("insert");
    expect(query.sql).not.toContain("delete from");
  });
  it("matches legacy title-case Activities codes", () => {
    const query = moveAuditActivitiesMaster().toSQL();
    expect(query.sql).toContain('lower("shared"."master_data_groups"."code")');
    expect(query.params).toContain("activities");
  });
  it("only corrects the QA/QC mapping, preserving other groups and global masters", () => {
    const query = moveAuditActivitiesMaster().toSQL();
    expect(query.sql).toContain('"master_data_groups"."app_scope" =');
    expect(query.params).toContain("qaqc");
    expect(query.params).not.toContain("global");
    expect(query.sql).toContain('"master_data_groups"."deleted_at" is null');
  });
  it("is idempotent because already-corrected Audit groups do not match the old scope", () => {
    const query = moveAuditActivitiesMaster().toSQL();
    const where = query.sql.split(" where ")[1];
    expect(where).toContain('"app_scope" =');
    expect(query.params.filter(value => value === "audit")).toHaveLength(1);
    expect(query.params.filter(value => value === "qaqc")).toHaveLength(1);
  });
  it("does not modify value labels, activity remarks or saved role assignments", () => {
    const query = moveAuditActivitiesMaster().toSQL();
    expect(query.sql).not.toContain("master_data_values");
    expect(query.sql).not.toContain("metadata");
    expect(query.sql).not.toContain("audit_plans");
    expect(query.sql).not.toContain("workspace_roles");
  });
});
