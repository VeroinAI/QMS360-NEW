import { afterEach, describe, expect, it } from "vitest";
import { XMLSerializer } from "@xmldom/xmldom";
import { DATE_FORMATS, formatDate, formatReportingPeriod, setDateFormatResolver } from "@workspace/spreadsheet-dates";
import { buildMonthlyReportDocument, monthlyDate } from "./qaqc-monthly-report-template";
import { buildDailyReportDocument } from "./qaqc-daily-report-template";
import { monthlyDashboardData } from "./qaqc-monthly-dashboard-data";
import { dailyDashboardData } from "./qaqc-daily-dashboard-data";
import { csatReportValues } from "./qaqc-csat-report-pdf";
import type { QaqcReportExport } from "./qaqc-reporting-export";
import { readFile, readdir } from "node:fs/promises";

afterEach(() => setDateFormatResolver(() => "DD/MM/YYYY"));
const report = (reportType: "monthly" | "daily" | "csat"): QaqcReportExport => ({
  id: "format-check", organizationId: "org", projectId: "project", projectName: "Project",
  reportType, period: "2026-04-03", state: "submitted",
  data: { pqpStatus: "Approved A", pqpSubmittedDate: "2026-04-03",
    pqpApprovedDate: "2026-04-03", meetings: [{ type: "Project Quality Meeting", lastDate: "2026-04-03" }] },
  baseline: {}, computed: {}, organizationTimezone: "Asia/Riyadh",
  submittedAt: "2026-04-02T22:30:00Z", submittedByName: "Actual Submitter", createdByName: "Actual Preparer",
});

describe("QA/QC organization date presentation", () => {
  it.each(DATE_FORMATS)("uses %s in Monthly, Daily, CSAT and dashboard mappings without changing saved ISO dates", async format => {
    setDateFormatResolver(() => format);
    const expected = formatDate("2026-04-03", format);
    const monthly = report("monthly"), daily = report("daily");
    expect(monthlyDate(monthly.period)).toBe(expected);
    expect(csatReportValues(report("csat")).date).toBe(expected);
    expect(Object.values(monthlyDashboardData(monthly).values)).toContain(expected);
    expect(Object.values(dailyDashboardData(daily).values).join(" ")).toContain(expected);
    const serializer = new XMLSerializer();
    const monthlyXml = serializer.serializeToString((await buildMonthlyReportDocument(monthly)).body);
    const dailyXml = serializer.serializeToString((await buildDailyReportDocument(daily)).body);
    expect(monthlyXml).toContain(expected);
    // Submission is 2 April UTC but 3 April in the organization time zone.
    expect(monthlyXml).toContain(`SUBMITTED ON`);
    expect(dailyXml).toContain(`${expected}  01:30`);
    expect(monthly.period).toBe("2026-04-03");
    expect(daily.submittedAt).toBe("2026-04-02T22:30:00Z");
  });

  it.each([
    ["DD/MM/YYYY", "04/2026"], ["MM/DD/YYYY", "04/2026"],
    ["YYYY-MM-DD", "2026-04"], ["DD-MM-YYYY", "04-2026"], ["MM-DD-YYYY", "04-2026"],
  ] as const)("preserves month-only precision with %s", (format, expected) => {
    expect(formatReportingPeriod("2026-04", format)).toBe(expected);
  });

  it("does not fabricate dates for blank or impossible report dates", () => {
    expect(monthlyDate("")).toBe("To be mapped");
    expect(monthlyDate("2026-02-30")).toBe("To be mapped");
  });

  it("keeps future QA/QC date inputs and report formatting on the shared organization path", async () => {
    const root = new URL("../../../qms360/src/pages/qaqc/", import.meta.url);
    const scan = async (dir: URL): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) await scan(url);
        else if (/\.tsx$/.test(entry.name) && !entry.name.includes(".test.")) {
          const source = await readFile(url, "utf8");
          expect(source, url.pathname).not.toMatch(/<input\b[^>]*type=["'](?:date|datetime-local)["']/);
          expect(source, url.pathname).not.toMatch(/toLocaleDateString\s*\(/);
        }
      }
    };
    await scan(root);
    for (const name of ["qaqc-monthly-report-template.ts", "qaqc-daily-report-template.ts"]) {
      const source = await readFile(new URL(name, import.meta.url), "utf8");
      expect(source, name).not.toMatch(/\$\{(?:match\[3\]|part\("day"\))\}-\$\{/);
    }
  });
});
