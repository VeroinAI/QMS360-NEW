import { describe, expect, it } from "vitest";
import { auditTeamLeadLabel } from "./team-lead-label";

describe("New Schedule Audit Team Lead labels", () => {
  it("shows the name followed by the email in parentheses, never the designation", () => {
    const user = { fullName: "Example User", email: "abc@xyz.com", designation: "QC Manager" };
    expect(auditTeamLeadLabel(user)).toBe("Example User (abc@xyz.com)");
  });

  it("distinguishes users who have the same name", () => {
    expect(auditTeamLeadLabel({ fullName: "Example User", email: "first@example.com" }))
      .not.toBe(auditTeamLeadLabel({ fullName: "Example User", email: "second@example.com" }));
  });

  it("trims surrounding email whitespace", () => {
    expect(auditTeamLeadLabel({ fullName: "Example User", email: " abc@xyz.com " }))
      .toBe("Example User (abc@xyz.com)");
  });

  it.each([null, "", "   "])("reports unavailable email explicitly for %j", email => {
    expect(auditTeamLeadLabel({ fullName: "Example User", email }))
      .toBe("Example User (Email unavailable)");
  });
});