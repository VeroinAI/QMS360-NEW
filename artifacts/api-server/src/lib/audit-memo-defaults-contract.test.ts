import { describe, expect, it } from "vitest";
import { GetPlatformAuditMemoDefaultsResponse, UpdatePlatformAuditMemoDefaultsBody } from "@workspace/api-zod";

describe("Audit memo defaults contract", () => {
  it("accepts free-text headings rather than requiring email addresses", () => {
    expect(UpdatePlatformAuditMemoDefaultsBody.parse({ from: "Quality Department", to: "All BU's, Function Heads and PM's" }))
      .toEqual({ from: "Quality Department", to: "All BU's, Function Heads and PM's" });
  });
  it("allows clearing both defaults", () => {
    expect(GetPlatformAuditMemoDefaultsResponse.parse({ from: "", to: "" })).toEqual({ from: "", to: "" });
  });
  it("requires both string fields", () => {
    for (const value of [{ from: "Dept" }, { to: "Heads" }, { from: null, to: "" }, { from: 5, to: "" }]) {
      expect(UpdatePlatformAuditMemoDefaultsBody.safeParse(value).success).toBe(false);
    }
  });
  it("accepts 500 characters and rejects longer input", () => {
    expect(UpdatePlatformAuditMemoDefaultsBody.safeParse({ from: "a".repeat(500), to: "b".repeat(500) }).success).toBe(true);
    expect(UpdatePlatformAuditMemoDefaultsBody.safeParse({ from: "a".repeat(501), to: "" }).success).toBe(false);
    expect(UpdatePlatformAuditMemoDefaultsBody.safeParse({ from: "", to: "b".repeat(501) }).success).toBe(false);
  });
  it("never treats unrelated settings as memo defaults", () => {
    expect(UpdatePlatformAuditMemoDefaultsBody.parse({ from: "Dept", to: "Heads", dateFormat: "MM/DD/YYYY" }))
      .toEqual({ from: "Dept", to: "Heads" });
  });
});
