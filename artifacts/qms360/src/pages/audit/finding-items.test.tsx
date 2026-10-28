// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuditFindingRegisterItem, ChecklistItem } from "@workspace/api-client-react";
import { FINDING_TAB_COLUMNS } from "./finding-tab-projection";

const permission = vi.hoisted(() => ({ edit: true }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/use-audit-capabilities", () => ({
  useAuditCapabilities: () => ({ can: () => permission.edit }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/use-lov", () => ({
  useLov: () => ({ options: [{ value: "design_engg", label: "Design and engineering" }], isLoading: false }),
}));
vi.mock("./finding-date", () => ({
  FindingDate: ({ readOnly }: { readOnly: boolean }) => <input aria-label="Finding Date" disabled={readOnly}/>,
}));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useListAuditMeetingAttendees: () => ({ data: [{ id: "owner", fullName: "Current owner" }] }),
  useListAuditEvidence: () => ({ data: { items: [] } }),
  useCreateAuditFindingItem: () => ({ mutateAsync: vi.fn() }),
  useAssignAuditFindingActionTaker: () => ({ mutateAsync: vi.fn() }),
  useCreateAuditEvidenceIntent: () => ({ mutateAsync: vi.fn() }),
  useConfirmAuditEvidence: () => ({ mutateAsync: vi.fn() }),
}));
import { FindingsGrid } from "./finding-items";

const current = {
  id: "item", clause: "8.2", question: "Question", auditFinding: "Major NC",
  auditArea: "design_engg", description: "Saved description", findingNumber: "NCR-1",
  findingDate: "2026-10-25", actionTakerId: "owner", recommendedPriorityAction: "Correct and close",
} as ChecklistItem;
const registry: AuditFindingRegisterItem = {
  id: "checklist:execution:item", source: "checklist", auditExecutionId: "execution",
  findingNumber: "NCR-1", auditId: "QREF-1", auditTitle: "Selected audit",
  projectDepartment: "Selected department", clauseReference: "8.2", auditArea: "Design and engineering",
  description: "Saved description", findingType: "Major NC", riskLevel: "High",
  auditTeamLeadId: "lead", auditTeamLeadName: "Saved Lead", actionTakers: [{ id: "owner", name: "Current owner" }],
};
function render(rows: AuditFindingRegisterItem[] = [registry], items: ChecklistItem[] = [current], awaitingSubmission = true) {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = renderToStaticMarkup(<FindingsGrid auditId="execution" auditTitle="Selected audit"
    items={items} registerRows={rows} awaitingSubmission={awaitingSubmission}/>);
  return doc;
}

describe("Audit Execution Findings tab", () => {
  it("explains checklist numbering before submission without promising a new number for submitted history", () => {
    permission.edit = false;
    const unnumbered = { ...current, findingNumber: undefined };
    const pending = render([registry], [unnumbered]);
    expect(pending.querySelector('[data-testid="text-finding-number-item"]')?.textContent)
      .toContain("Finding ID will be generated on submission for approval.");
    const historical = render([registry], [unnumbered], false);
    expect(historical.querySelector('[data-testid="text-finding-number-item"]')?.textContent).toBe("Not numbered");
    const manual = render([registry], [{ ...unnumbered, source: "finding" }]);
    expect(manual.querySelector('[data-testid="text-finding-number-item"]')?.textContent).toBe("Not numbered");
    permission.edit = true;
  });
  it("renders the requested columns and seven filters in a single native scroll region", () => {
    permission.edit = true;
    const doc = render();
    expect([...doc.querySelectorAll("thead th")].map(node => node.textContent)).toEqual([...FINDING_TAB_COLUMNS]);
    expect(doc.querySelectorAll("label")).toHaveLength(7);
    const region = doc.querySelector('[data-testid="region-findings-scroll"]')!;
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.querySelector(":scope > table")).not.toBeNull();
    expect(region.querySelectorAll("table")).toHaveLength(1);
    expect(region.querySelector("thead tr")?.className).toContain("bg-primary");
    expect(region.textContent).toContain("QREF-1");
    expect(region.textContent).toContain("Saved Lead");
  });
  it("keeps legacy rows read-only while preserving current-row controls", () => {
    permission.edit = true;
    const doc = render([registry, { ...registry, id: "legacy:historical", source: "legacy", findingNumber: "OLD-1" }]);
    expect(doc.querySelector('[data-testid="button-add-finding"]')?.hasAttribute("disabled")).toBe(false);
    expect(doc.querySelector('[data-testid="select-action-taker-item"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="select-priority-action-item"]')).not.toBeNull();
    const legacy = doc.querySelector('[data-testid="row-legacy-finding-legacy:historical"]')!;
    expect(legacy.textContent).toContain("Legacy, read-only");
    expect(legacy.querySelector("button,input,select")).toBeNull();
    expect(doc.querySelector('[data-testid="row-finding-item"]')).not.toBeNull();
  });
  it("does not enable finding writes for a read-only viewer", () => {
    permission.edit = false;
    const doc = render();
    expect(doc.querySelector('[data-testid="button-add-finding"]')?.hasAttribute("disabled")).toBe(true);
    expect(doc.querySelector('[data-testid="select-action-taker-item"]')?.hasAttribute("disabled")).toBe(true);
    permission.edit = true;
  });
});
