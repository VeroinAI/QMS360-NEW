import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditOverviewReferences } from "./overview-references";

describe("Audit Overview references", () => {
  it("renders long real labels with wrapping and no identifier, code or title fallback", () => {
    const audit = {
      projectId: "22222222-2222-4222-8222-222222222222",
      planId: "33333333-3333-4333-8333-333333333333",
      projectName: "Regional Infrastructure Delivery and Long-Term Quality Assurance Programme",
      planNumber: "QMS360/PLAN/REGIONAL-INFRASTRUCTURE/2026/000127",
      projectCode: "REG-01", planTitle: "An audit plan title", planAvailable: true,
    };
    const html = renderToStaticMarkup(<AuditOverviewReferences audit={audit}/>);
    expect(html).toContain(audit.projectName);
    expect(html).toContain(audit.planNumber);
    for (const forbidden of [audit.projectId, audit.planId, audit.projectCode, audit.planTitle]) expect(html).not.toContain(forbidden);
    expect(html.match(/min-w-0/g)).toHaveLength(2);
    expect(html.match(/overflow-wrap:anywhere/g)).toHaveLength(2);
  });

  it.each([null, undefined, "", "  "])("labels existing unnumbered plans as Not assigned (%s)", planNumber => {
    const html = renderToStaticMarkup(<AuditOverviewReferences audit={{ projectName: "Actual project", planNumber, planAvailable: true }}/>);
    expect(html).toContain("Actual project");
    expect(html).toContain("Not assigned");
    expect(html).not.toContain("Not available");
  });

  it("labels missing project and plan context as Not available, never as an unnumbered plan", () => {
    const html = renderToStaticMarkup(<AuditOverviewReferences audit={{ projectName: null, planNumber: null, planAvailable: false }}/>);
    expect(html.match(/Not available/g)).toHaveLength(2);
    expect(html).not.toContain("Not assigned");
  });

  it("keeps projectless process audits readable without inventing a project", () => {
    const html = renderToStaticMarkup(<AuditOverviewReferences audit={{ projectName: null, planNumber: "PROCESS/2026/007", planAvailable: true }}/>);
    expect(html).toContain("Not available");
    expect(html).toContain("PROCESS/2026/007");
  });

  it("handles an older cached response without showing UUIDs", () => {
    const html = renderToStaticMarkup(<AuditOverviewReferences audit={{}}/>);
    expect(html.match(/Not available/g)).toHaveLength(2);
  });
});
