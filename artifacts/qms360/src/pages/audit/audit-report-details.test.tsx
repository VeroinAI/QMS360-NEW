import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Audit } from "@workspace/api-client-react";
import { auditReportDetailGroups } from "@workspace/field-controls";
import { AuditReportDetailsEditor } from "./audit-report-details";

const { editAccess } = vi.hoisted(() => ({ editAccess: vi.fn(() => true) }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useSaveAuditReportDetails: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("./audit-complete", () => ({
  useAuditEditAccess: editAccess,
}));

const audit = {
  id: "audit-test",
  status: "In Progress",
  reportDetails: {
    values: {
      reportRevision: "legacy revision",
      client: "legacy client",
      objective: "legacy objective",
      progressComment: "legacy progress",
      reportIssueDate: "2026-10-05",
      distribution: "legacy distribution",
      headlineConclusion: "Retained conclusion",
    },
    rows: { signOff: [{ name: "legacy signatory" }] },
  },
} as unknown as Audit;

describe("Audit Report Details editor", () => {
  it("removes exactly the requested tiles and conclusion controls", () => {
    const html = renderToStaticMarkup(<AuditReportDetailsEditor audit={audit} />);
    for (const label of [
      "Document control", "Project profile", "Objective, scope, criteria and method",
      "Overall project progress (when applicable)", "Report issue date",
      "Distribution (names / departments)", "Report sign-off",
    ]) expect(html).not.toContain(label);
    for (const value of ["legacy revision", "legacy client", "legacy objective", "legacy progress", "legacy distribution", "legacy signatory"]) {
      expect(html).not.toContain(value);
    }
    for (const label of [
      "Executive summary and recurring themes", "Recommended priority actions",
      "Photograph captions", "Conclusion, distribution and sign-off",
      "Headline conclusion", "Were the objectives achieved?",
      "System effectiveness and priority findings", "Follow-up audit date", "Follow-up audit scope",
    ]) expect(html).toContain(label);
    expect(html).toContain("Retained conclusion");
    expect(html).toContain('data-testid="button-save-report-details"');
  });

  it("does not mutate the report catalog or saved legacy data", () => {
    const before = JSON.stringify(audit);
    renderToStaticMarkup(<AuditReportDetailsEditor audit={audit} />);
    expect(JSON.stringify(audit)).toBe(before);
    expect(auditReportDetailGroups.map(group => group.key)).toEqual([
      "document", "profile", "scope", "summary", "progress", "actions", "photographs", "conclusion",
    ]);
    const conclusion = auditReportDetailGroups.find(group => group.key === "conclusion")!;
    expect(conclusion.fields.map(field => field.key)).toContain("reportIssueDate");
    expect(conclusion.fields.map(field => field.key)).toContain("distribution");
    expect(conclusion.collections?.map(collection => collection.key)).toContain("signOff");
  });

  it("preserves read-only access for remaining fields and save", () => {
    editAccess.mockReturnValueOnce(false);
    const html = renderToStaticMarkup(<AuditReportDetailsEditor audit={audit} />);
    expect(html).toMatch(/<input[^>]*id="rd-conclusion-headlineConclusion"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="button-save-report-details"/);
  });
});
