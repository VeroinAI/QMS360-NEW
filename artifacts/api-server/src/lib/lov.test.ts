import { describe, expect, it } from "vitest";
import { masterDataGroupCodeAliases } from "./lov";

describe("masterDataGroupCodeAliases", () => {
  it("accepts singular and case-insensitive department group codes", () => {
    expect(masterDataGroupCodeAliases("departments")).toEqual(["departments", "department"]);
    expect(masterDataGroupCodeAliases("Department")).toEqual(["departments", "department"]);
  });

  it("does not broaden unrelated master-data group codes", () => {
    expect(masterDataGroupCodeAliases("audit_types")).toEqual(["audit_types"]);
  });
});