import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportButton, isAuditReportEligible } from "./audit-complete";

describe("Audit workspace PowerPoint report button", () => {
  it.each(["Complete", "Closed"])("downloads directly instead of navigating for %s audits", status => {
    const html = renderToStaticMarkup(<ReportButton audit={{ id: "audit-1", status }}/>);
    expect(html).toContain("Download PowerPoint report");
    expect(html).toContain('data-testid="button-report-audit-1"');
    expect(html).toContain("Report");
    expect(html).not.toContain("href=");
    expect(html).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });
  it.each(["Draft", "Scheduled", "In Progress"])("preserves the completion gate for %s", status => {
    const html = renderToStaticMarkup(<ReportButton audit={{ id: "audit-1", status }}/>);
    expect(html).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).toContain("Report is available once the audit is marked Complete");
    expect(isAuditReportEligible(status)).toBe(false);
  });
});
