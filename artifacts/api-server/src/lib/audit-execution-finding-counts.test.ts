import { describe, expect, it } from "vitest";
import { auditExecutionFindingCounts as counts } from "./audit-execution-finding-counts";

describe("Audit Execution finding counts", () => {
  it("counts current findings, excludes blank and Not applicable, and deduplicates mirrors", () => {
    expect(counts([
      { id: "a", auditFinding: "Major NC" }, { id: "b", auditFinding: "OFI" },
      { id: "b", auditFinding: "OFI" }, { id: "c", auditFinding: "Not applicable", result: "Major NC" },
      { id: "d" },
    ], [{ id: "mirror", classification: "Major NC", evidence: { sourceChecklistItemId: "a" } }], []))
      .toEqual({ findingCount: 2, openFindingCount: 2 });
  });
  it("includes standalone historical findings but does not revive removed checklist mirrors", () => {
    expect(counts([], [
      { id: "old", classification: "Minor NC", status: "Open" },
      { id: "closed", classification: "Major NC", status: "Closed" },
      { id: "verified", classification: "OFI", status: "Verified" },
      { id: "na", classification: "Not applicable" },
      { id: "deleted", classification: "Minor NC", status: "Deleted" },
      { id: "mirror", classification: "Major NC", evidence: { sourceChecklistItemId: "removed" } },
    ], [])).toEqual({ findingCount: 3, openFindingCount: 1 });
  });
  it("saved/submitted CAR responses remain open; only terminal responses close findings", () => {
    const items = ["open", "submitted", "closed", "verified", "none"].map(id => ({ id, auditFinding: "Minor NC" }));
    const mirrors = items.map(item => ({ id: `m-${item.id}`, classification: "Minor NC", evidence: { sourceChecklistItemId: item.id } }));
    const cars = ["open", "submitted", "closed", "verified"].map(state => ({ auditFindingId: `m-${state}`, workflowState: state }));
    expect(counts(items, mirrors, cars)).toEqual({ findingCount: 5, openFindingCount: 3 });
  });
  it("an unfinished response keeps a finding open even when another response closed it", () => {
    expect(counts([{ id: "a", auditFinding: "OFI" }], [
      { id: "mirror", classification: "OFI", status: "Closed", evidence: { sourceChecklistItemId: "a" } },
    ], [
      { auditFindingId: "mirror", workflowState: "closed" },
      { auditFindingId: "mirror", workflowState: "in_progress" },
    ])).toEqual({ findingCount: 1, openFindingCount: 1 });
  });
  it("returns real zero counts for an empty or legacy non-array checklist", () => {
    expect(counts(null, [], [])).toEqual({ findingCount: 0, openFindingCount: 0 });
    expect(counts({ rows: [] }, [], [])).toEqual({ findingCount: 0, openFindingCount: 0 });
  });
});
