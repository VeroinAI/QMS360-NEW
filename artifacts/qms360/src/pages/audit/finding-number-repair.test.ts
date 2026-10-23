import { describe, expect, it } from "vitest";
import { canRepairFindingNumber } from "./finding-number-repair";

describe("Finding number repair visibility", () => {
  it.each(["Minor NC", "Moderate NC", "Major NC", "OFI"])("offers recovery only for an unnumbered %s", type => {
    expect(canRepairFindingNumber(type)).toBe(true);
    expect(canRepairFindingNumber(type, " \t")).toBe(true);
    expect(canRepairFindingNumber(type, "FN-26-0001")).toBe(false);
  });
  it.each([undefined, null, "", "Not applicable", "Conforming", "Observation"])("excludes unsupported classification %s", type => {
    expect(canRepairFindingNumber(type)).toBe(false);
  });
});
