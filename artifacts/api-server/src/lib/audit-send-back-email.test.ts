import { describe, expect, it } from "vitest";
import { auditScheduleSendBackCcIds } from "./email-rules";
import { smtpMessageHeaders } from "./email";

describe("Audit schedule send-back email audience", () => {
  it("CCs only earlier approvers and the reviewer sending back, not the creator or pending role members", () => {
    expect(auditScheduleSendBackCcIds("creator", ["level-1", "level-2"], "level-2"))
      .toEqual(["level-1", "level-2"]);
    expect(auditScheduleSendBackCcIds("creator", [], "level-1"))
      .toEqual(["level-1"]);
    expect(auditScheduleSendBackCcIds("creator", ["creator", "level-1"], "level-2"))
      .toEqual(["level-1", "level-2"]);
  });
});

describe("SMTP From policy", () => {
  it("always uses the configured From Address even when a workflow supplies a contact", () => {
    expect(smtpMessageHeaders({ fromAddress: "system@example.com", fromName: "QMS360" }, { email: "reviewer@example.com" }))
      .toEqual({ from: '"QMS360" <system@example.com>', replyTo: "reviewer@example.com" });
    expect(smtpMessageHeaders({ fromAddress: "system@example.com", fromName: "QMS360" }))
      .toEqual({ from: '"QMS360" <system@example.com>', replyTo: "system@example.com" });
  });
});