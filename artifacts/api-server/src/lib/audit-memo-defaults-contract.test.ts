import { describe, expect, it } from "vitest";
import {
  GetPlatformAuditMemoDefaultsResponse, UpdatePlatformAuditMemoDefaultsBody,
  GetAuditProgrammeResponse, ListAuditProgrammesResponse, SubmitAuditProgrammeBody,
  SubmitAuditProgrammeResponse,
} from "@workspace/api-zod";

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

describe("Audit Schedule saved submission contracts", () => {
  const programme = {
    id: "schedule-a", title: "Annual schedule", fromDate: "2026-01-01", toDate: "2026-12-31",
    teamLeadIds: [], teamLeadNames: [], workflowState: "Sent Back", childCount: 1,
    currentApprovalRole: null, currentApproverNames: [], approvalRoles: [],
    canReview: false, canSubmit: true, canManageTeamLeads: false,
    submissionReference: "REF-001", submissionFrom: "Quality", submissionTo: "Department heads",
    submissionSubject: "Saved submission subject", submissionMailBody: "Saved memo\n\nSecond paragraph",
  };

  it("retains saved content in both list and detail responses", () => {
    const list = ListAuditProgrammesResponse.parse({ items: [programme], total: 1, page: 1, limit: 10 });
    const detail = GetAuditProgrammeResponse.parse(programme);
    for (const item of [list.items[0], detail]) {
      expect(item.submissionSubject).toBe(programme.submissionSubject);
      expect(item.submissionMailBody).toBe(programme.submissionMailBody);
      expect(item.submissionReference).toBe(programme.submissionReference);
    }
  });

  it("accepts edited resubmission content and returns the latest version", () => {
    const edits = SubmitAuditProgrammeBody.parse({
      reference: programme.submissionReference, from: "Current Quality", to: "Current audience",
      subject: "Revised subject", mailBody: "Revised memo\n\nAdditional explanation",
    });
    const result = SubmitAuditProgrammeResponse.parse({
      ...programme, workflowState: "Submitted",
      submissionReference: edits.reference, submissionFrom: edits.from, submissionTo: edits.to,
      submissionSubject: edits.subject, submissionMailBody: edits.mailBody,
    });
    expect(result.submissionSubject).toBe(edits.subject);
    expect(result.submissionMailBody).toBe(edits.mailBody);
    expect(programme.submissionSubject).toBe("Saved submission subject");
  });

  it("supports null saved values on never-submitted schedules", () => {
    expect(GetAuditProgrammeResponse.parse({
      ...programme, submissionReference: null, submissionSubject: null, submissionMailBody: null,
    })).toMatchObject({ submissionReference: null, submissionSubject: null, submissionMailBody: null });
  });
});
