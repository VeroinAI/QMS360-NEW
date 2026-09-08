import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mock = vi.hoisted(() => ({
  selectResults: [] as Array<Array<Record<string, unknown>>>,
  selections: [] as Array<Record<string, unknown> | undefined>,
  updates: [] as Array<Record<string, unknown>>,
  execute: vi.fn(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: vi.fn((selection?: Record<string, unknown>) => {
        mock.selections.push(selection);
        return {
          from: () => ({
            where: () => ({
              limit: async () => mock.selectResults.shift() ?? [],
            }),
          }),
        };
      }),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          mock.updates.push(values);
          return { where: async () => undefined };
        },
      })),
      execute: mock.execute,
    },
  };
});

import { applyEntityRows } from "../src/lib/source-sync";

const dialect = new PgDialect();

beforeEach(() => {
  mock.selectResults = [];
  mock.selections = [];
  mock.updates = [];
  mock.execute.mockReset().mockResolvedValue({ rows: [] });
});

describe("source-sync user compatibility", () => {
  it("uses a narrow user lookup and an explicit compatible insert", async () => {
    // Existing-email lookup, then username availability lookup.
    mock.selectResults.push([], []);

    const result = await applyEntityRows("org-1", "users", "api", [{
      email: "new.user@example.test",
      fullName: "New User",
      username: "new.user",
      "custom.department": "Quality",
    }]);

    expect(result).toMatchObject({ sourceCount: 1, targetCount: 1, errors: [] });
    expect(mock.selections[0]).toBeDefined();
    expect(Object.keys(mock.selections[0]!)).toEqual(["id", "username", "customFields"]);
    expect(Object.values(mock.selections[0]!).map((column: any) => column.name))
      .not.toContain("must_change_password");

    const statement = mock.execute.mock.calls[0]![0];
    const query = dialect.sqlToQuery(statement);
    expect(query.sql).toMatch(/insert into shared\.users\s*\(\s*organization_id,\s*email,\s*username,\s*full_name,\s*project_id,\s*password_hash,\s*auth_source,\s*custom_fields\s*\)/i);
    expect(query.sql).not.toMatch(/must_change_password/i);
    expect(query.params).toContain("org-1");
    expect(query.params).toContain('{"department":"Quality"}');
  });

  it("preserves stored custom fields while updating mapped user fields", async () => {
    mock.selectResults.push([{
      id: "user-1", username: "old-name", customFields: { region: "North", department: "Old" },
    }]);

    const result = await applyEntityRows("org-1", "users", "excel", [{
      email: "existing@example.test",
      fullName: "Existing Updated",
      "custom.department": "Quality",
      "custom.job_title": "Inspector",
    }]);

    expect(result).toMatchObject({ targetCount: 1, errors: [] });
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0]).toMatchObject({
      fullName: "Existing Updated",
      customFields: { region: "North", department: "Quality", job_title: "Inspector" },
    });
  });

  it("keeps validation and duplicate errors readable", async () => {
    // The invalid first row performs no query. The second checks email then
    // finds its generated username already in use.
    mock.selectResults.push([], [{ id: "taken-user" }]);

    const result = await applyEntityRows("org-1", "users", "api", [
      { email: "not-an-email" },
      { email: "duplicate@example.test", fullName: "Duplicate", username: "taken" },
    ]);

    expect(result.targetCount).toBe(0);
    expect(result.errors).toEqual([
      { row: 1, message: "Missing or invalid email" },
      { row: 2, message: 'Username "taken" is already in use' },
    ]);
  });

  it("does not disclose unexpected database errors in row results", async () => {
    mock.selectResults.push([], []);
    mock.execute.mockRejectedValueOnce(new Error("database connection password leaked"));

    const result = await applyEntityRows("org-1", "users", "api", [{
      email: "db-error@example.test", fullName: "Database Error", username: "db-error",
    }]);

    expect(result).toMatchObject({
      sourceCount: 1,
      targetCount: 0,
      errors: [{ row: 1, message: "Row could not be imported" }],
    });
    expect(JSON.stringify(result)).not.toContain("database connection");
  });
});