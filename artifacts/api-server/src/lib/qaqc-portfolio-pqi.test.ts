import { describe, expect, it } from "vitest";
import { calculatePortfolioPqi } from "./qaqc-portfolio-pqi";

const project = (id: string, extra: Record<string, unknown> = {}) => ({ id, organizationId: "org-1", status: "active", ...extra });
const report = (projectId: string, extra: Record<string, unknown> = {}) => ({
  organizationId: "org-1",
  projectId,
  reportType: "monthly",
  period: "2025-02-01",
  state: "submitted",
  computed: { pqi: { accumulated: 50 } },
  createdAt: "2025-02-20T12:00:00.000Z",
  ...extra,
});

describe("calculatePortfolioPqi", () => {
  it("calculates an average only when every active project has a valid report, including zero scores", () => {
    for (const [scores, average] of [[[0, 100], 50], [[0, 0], 0], [[100, 100], 100]] as const) {
      expect(calculatePortfolioPqi({
        organizationId: "org-1",
        period: "2025-02-01",
        projects: [project("a"), project("b")],
        reports: [
          report("a", { computed: { pqi: { accumulated: scores[0] } } }),
          report("b", { state: "approved", computed: { pqi: { accumulated: scores[1] } } }),
        ],
      })).toMatchObject({ average, status: "complete", reportedProjectCount: 2, pendingProjectCount: 0 });
    }
  });
  it("treats scores outside the accumulated PQI percentage range as pending", () => {
    for (const score of [-1, 101]) {
      expect(calculatePortfolioPqi({
        organizationId: "org-1", period: "2025-02-01",
        projects: [project("a")],
        reports: [report("a", { computed: { pqi: { accumulated: score } } })],
      })).toMatchObject({ average: null, status: "pending", pendingProjectCount: 1 });
    }
  });
  it("averages only readable, valid submitted or approved same-period monthly snapshots once per active project", () => {
    const result = calculatePortfolioPqi({
      organizationId: "org-1",
      period: "2025-02-01",
      projects: [project("a"), project("b"), project("c")],
      reports: [
        report("a", { computed: { pqi: { accumulated: 0 } }, id: "a1" }),
        report("b", { state: "approved", computed: { pqi: { accumulated: 100 } }, id: "b1" }),
        report("b", { id: "b2", createdAt: "2025-02-22T12:00:00.000Z", computed: { pqi: { accumulated: 80 } } }),
        report("c", { id: "c-draft", state: "draft" }),
        report("c", { id: "c-sent-back", state: "sent_back" }),
        report("c", { id: "c-prior", period: "2025-01-01" }),
        report("c", { id: "c-other-type", reportType: "daily" }),
      ],
      canReadReport: (row) => row.projectId !== "b" || row.id === "b2",
    });

    expect(result).toEqual({
      average: null,
      activeProjectCount: 3,
      reportedProjectCount: 2,
      pendingProjectCount: 1,
      status: "pending",
      period: "2025-02-01",
    });
  });

  it("treats missing, malformed, and nonfinite accumulated PQI as pending", () => {
    const result = calculatePortfolioPqi({
      organizationId: "org-1",
      period: "2025-02-01",
      projects: [project("missing"), project("malformed"), project("infinite")],
      reports: [
        report("missing", { computed: {} }),
        report("malformed", { computed: { pqi: { accumulated: "0" } } }),
        report("infinite", { computed: { pqi: { accumulated: Number.POSITIVE_INFINITY } } }),
      ],
    });
    expect(result.average).toBeNull();
    expect(result.reportedProjectCount).toBe(0);
    expect(result.pendingProjectCount).toBe(3);
    expect(result.status).toBe("pending");
  });

  it("does not fall back to an older duplicate when the deterministic newest snapshot is invalid", () => {
    const result = calculatePortfolioPqi({
      organizationId: "org-1",
      period: "2025-02-01",
      projects: [project("duplicate")],
      reports: [
        report("duplicate", { id: "older", computed: { pqi: { accumulated: 75 } } }),
        report("duplicate", {
          id: "newer",
          createdAt: "2025-02-22T12:00:00.000Z",
          computed: { pqi: { accumulated: Number.NaN } },
        }),
      ],
    });
    expect(result.average).toBeNull();
    expect(result.reportedProjectCount).toBe(0);
    expect(result.pendingProjectCount).toBe(1);
  });

  it("returns an empty portfolio when there are no authorized active projects", () => {
    const result = calculatePortfolioPqi({
      organizationId: "org-1",
      period: "2025-02-01",
      projects: [
        project("inactive", { status: "inactive" }),
        project("deleted", { deletedAt: new Date() }),
        project("other-org", { organizationId: "org-2" }),
      ],
      reports: [report("inactive"), report("deleted"), report("other-org")],
    });
    expect(result).toEqual({
      average: null,
      activeProjectCount: 0,
      reportedProjectCount: 0,
      pendingProjectCount: 0,
      status: "empty",
      period: "2025-02-01",
    });
  });

  it("marks a fully reported zero-valued PQI as complete", () => {
    const result = calculatePortfolioPqi({
      organizationId: "org-1",
      period: "2025-02-01",
      projects: [project("zero")],
      reports: [report("zero", { computed: { pqi: { accumulated: 0 } } })],
    });
    expect(result.average).toBe(0);
    expect(result.status).toBe("complete");
    expect(result.pendingProjectCount).toBe(0);
  });
});