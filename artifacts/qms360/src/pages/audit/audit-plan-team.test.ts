import { describe, expect, it } from "vitest";
import { auditTeamWithoutLead } from "./audit-plan-team";

describe("Audit Plan team excludes its Lead / Internal Auditor", () => {
  it("removes an already selected team member when they become lead", () => {
    expect(auditTeamWithoutLead(["member-a", "member-b", "member-c"], "member-b"))
      .toEqual(["member-a", "member-c"]);
  });
  it("prevents adding the currently selected lead to the team", () => {
    expect(auditTeamWithoutLead(["member-a", "lead"], "lead")).toEqual(["member-a"]);
  });
  it("keeps other members and their ordering when the lead changes", () => {
    expect(auditTeamWithoutLead(["member-a", "member-c"], "member-c")).toEqual(["member-a"]);
  });
  it("does not add a former lead back automatically", () => {
    const team = auditTeamWithoutLead(["member-a", "member-b"], "member-a");
    expect(auditTeamWithoutLead(team, "member-b")).toEqual([]);
  });
  it("retains team selections when the lead is cleared or not selected", () => {
    expect(auditTeamWithoutLead(["member-a", "member-b"], "")).toEqual(["member-a", "member-b"]);
  });
  it("can leave an empty team for the existing mandatory-field validation", () => {
    expect(auditTeamWithoutLead(["lead"], "lead")).toEqual([]);
    expect(auditTeamWithoutLead([], "lead")).toEqual([]);
  });
  it("removes every occurrence of the lead without mutating the original selection", () => {
    const original = ["lead", "member-a", "lead"];
    expect(auditTeamWithoutLead(original, "lead")).toEqual(["member-a"]);
    expect(original).toEqual(["lead", "member-a", "lead"]);
  });
});
