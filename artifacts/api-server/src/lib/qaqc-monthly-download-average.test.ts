import { describe, expect, it } from "vitest";
import { monthlyDownloadAverage } from "./qaqc-monthly-download-average";

const report = (projectId: string, accumulated: unknown) => ({ projectId, computed: { pqi: { accumulated } } });

describe("Monthly PDF download-time PQI average", () => {
  it("averages accumulated scores across the projects that reported, without waiting for others", () => {
    expect(monthlyDownloadAverage([report("a", 45.5), report("b", 29.5)]))
      .toEqual({ average: 37.5, projectCount: 2 });
  });
  it("includes real zero scores and returns the project count", () => {
    expect(monthlyDownloadAverage([report("a", 0), report("b", 100)]))
      .toEqual({ average: 50, projectCount: 2 });
  });
  it("does not double-count a project", () => {
    expect(monthlyDownloadAverage([report("a", 40), report("a", 50)]))
      .toEqual({ average: 50, projectCount: 1 });
  });
  it("keeps empty or incomplete source data unmapped rather than inventing scores", () => {
    expect(monthlyDownloadAverage([])).toEqual({ average: null, projectCount: 0 });
    expect(monthlyDownloadAverage([report("a", 75), report("b", undefined)]))
      .toEqual({ average: null, projectCount: 2 });
  });
});
