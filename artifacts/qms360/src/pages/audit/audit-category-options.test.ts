import { describe, expect, it } from "vitest";
import { categoryOptionsForAuditType } from "./audit-category-options";

const categories = [
  { value: "Business Unit", label: "Business Unit", metadata: { auditTypeValues: ["Process"] } },
  { value: "Project", label: "Project", metadata: { auditTypeValues: ["Product"] } },
  { value: "Unlinked", label: "Unlinked", metadata: {} },
];

describe("Audit Category choices", () => {
  it("has no choices before an Audit Type is selected", () => {
    expect(categoryOptionsForAuditType(categories, "")).toEqual([]);
  });

  it("shows only categories linked to the selected type after configuration", () => {
    expect(categoryOptionsForAuditType(categories, "Process").map(option => option.value)).toEqual(["Business Unit"]);
    expect(categoryOptionsForAuditType(categories, "Product").map(option => option.value)).toEqual(["Project"]);
  });

  it("retains existing unrestricted master data until links are configured", () => {
    const unlinked = categories.map(category => ({ ...category, metadata: {} }));
    expect(categoryOptionsForAuditType(unlinked, "Process")).toEqual(unlinked);
  });
});