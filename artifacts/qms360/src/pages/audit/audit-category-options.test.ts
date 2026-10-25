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

  it("restricts standard Product and Process audits regardless of old master-data links", () => {
    const values = ["Project", "Business Unit", "Regional Office", "Warehouse", "Other"]
      .map(value => ({ value, label: value, metadata: { auditTypeValues: ["Quality Internal Product Audit", "Quality Internal Process Audit"] } }));
    expect(categoryOptionsForAuditType(values, "Quality Internal Product Audit").map(c => c.value)).toEqual(["Project"]);
    expect(categoryOptionsForAuditType(values, "Quality Internal Process Audit").map(c => c.value))
      .toEqual(["Business Unit", "Regional Office", "Warehouse"]);
    expect(categoryOptionsForAuditType(values, "Product Audit").map(c => c.value)).toEqual(["Project"]);
    expect(categoryOptionsForAuditType(values, "Process Audit").map(c => c.value))
      .toEqual(["Business Unit", "Regional Office", "Warehouse"]);
  });
});