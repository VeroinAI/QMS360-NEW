import { describe, expect, it } from "vitest";
import { mergeAuditChecklistImport } from "./audit-checklist-import";

const original = {
  id: "original", clause: "9.2", auditArea: "Construction", question: "Are records complete?",
  description: "Old description", auditFinding: "Minor NC", evidenceIds: ["evidence"],
  correctiveActionId: "car", actionTakerId: "owner", notes: "Historical notes",
};
const values = (row: Record<string, any>, evidenceIds: string[]) => ({
  clause: row.clause.trim(), auditArea: row.auditArea.trim(), question: row.question.trim(),
  description: row.description?.trim() || null, auditFinding: row.auditFinding || null, evidenceIds,
});
const merge = (rows: Record<string, any>[], existing: Record<string, any>[] = [original]) =>
  mergeAuditChecklistImport(existing, rows, values, () => "new-id");

describe("Audit Checklist Excel natural-key merge", () => {
  it("updates a matching triple without requiring a hidden Item ID", () => {
    const result = merge([{ clause: original.clause, auditArea: original.auditArea, question: original.question,
      description: "Updated", auditFinding: "OFI" }]);
    expect(result.checklist).toEqual([{ ...original, description: "Updated", auditFinding: "OFI" }]);
    expect(result.matches[0].previous?.id).toBe("original");
    expect(original.description).toBe("Old description");
  });
  it("preserves the existing ID, evidence and CAR metadata when the hidden ID is present", () => {
    expect(merge([{ ...original, description: "Updated" }]).checklist)
      .toEqual([{ ...original, description: "Updated" }]);
  });
  it.each(["clause", "auditArea", "question"])("inserts when %s changes, even with a copied hidden ID", field => {
    const row = { ...original, [field]: "Different value", description: "New" };
    const result = merge([row]);
    expect(result.checklist).toHaveLength(2);
    expect(result.checklist[0]).toBe(original);
    expect(result.checklist[1]).toMatchObject({ id: "new-id", [field]: "Different value", description: "New", evidenceIds: [] });
    expect(result.checklist[1].correctiveActionId).toBeUndefined();
  });
  it("trims identity values and safely handles delimiter characters", () => {
    const result = merge([{ clause: " 9.2 ", auditArea: " Construction ", question: " Are records complete? ", description: "Checked" }]);
    expect(result.checklist).toHaveLength(1);
    const unusual = { ...original, clause: "a|b", auditArea: "c", question: "d" };
    expect(merge([{ clause: "a", auditArea: "b|c", question: "d" }], [unusual]).checklist).toHaveLength(2);
  });
  it("upserts repeated new workbook rows into one row with the last values", () => {
    const first = { clause: "10", auditArea: "Construction", question: "New?", description: "First" };
    const result = merge([first, { ...first, description: "Last", auditFinding: "Major NC" }]);
    expect(result.checklist).toHaveLength(2);
    expect(result.checklist[1]).toMatchObject({ id: "new-id", description: "Last", auditFinding: "Major NC" });
  });
  it("uses the key even when repeated exported rows retain the same hidden ID", () => {
    const result = merge([{ ...original, description: "First" }, { ...original, description: "Last" }]);
    expect(result.checklist).toEqual([{ ...original, description: "Last" }]);
  });
  it("is idempotent when the same file is uploaded again", () => {
    const rows = [{ clause: original.clause, auditArea: original.auditArea, question: original.question, description: "Changed" },
      { clause: "10", auditArea: "Construction", question: "New?", description: "New" }];
    const first = merge(rows).checklist;
    expect(merge(rows, first).checklist).toEqual(first);
  });
  it("clears blank imported description and finding while retaining evidence", () => {
    expect(merge([{ ...original, description: "", auditFinding: "" }]).checklist[0])
      .toEqual({ ...original, description: null, auditFinding: null });
  });
  it("does not match finding-only records or modify unrelated rows", () => {
    const finding = { ...original, id: "finding", source: "finding" };
    const unrelated = { ...original, id: "unrelated", clause: "8" };
    const result = merge([{ clause: original.clause, auditArea: original.auditArea, question: original.question }], [finding, unrelated]);
    expect(result.checklist).toHaveLength(3);
    expect(result.checklist[0]).toBe(finding);
    expect(result.checklist[1]).toBe(unrelated);
  });
  it("rejects foreign IDs and finding-only IDs without changing existing data", () => {
    expect(() => merge([{ ...original, id: "foreign" }])).toThrow(/not in this audit/);
    expect(() => merge([{ ...original, id: "finding" }], [{ ...original, id: "finding", source: "finding" }]))
      .toThrow(/finding-only/);
    expect(original.description).toBe("Old description");
  });
  it("retains historical duplicates instead of silently deleting linked records", () => {
    const duplicate = { ...original, id: "duplicate", evidenceIds: ["other-evidence"] };
    const result = merge([{ clause: original.clause, auditArea: original.auditArea, question: original.question, description: "Changed" }], [original, duplicate]);
    expect(result.checklist).toHaveLength(2);
    expect(result.checklist[0].description).toBe("Changed");
    expect(result.checklist[1]).toBe(duplicate);
  });
  it("rejects incomplete import identities", () => {
    expect(() => merge([{ ...original, question: " " }])).toThrow(/required/);
  });
});
