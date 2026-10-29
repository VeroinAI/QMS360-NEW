import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailReportOptions, eventsForWorkspace } from "@workspace/field-controls";
import { approvalEmailEvent, finalApprovalEmailEvents } from "./approval-email-events";
import { resolveEmailRule } from "./email-rules";

vi.mock("./email-queue", () => ({ enqueueEmail: vi.fn() }));
const input = (app: string, entityType: string, action: string, record: Record<string, any>) =>
  ({ organizationId: "tenant", actorId: "reviewer", entityId: "record", app, entityType, action, record });

describe("Final approval event classification", () => {
  it.each(["monthly", "daily"])("classifies only the last %s approval and keeps its record ID", reportType => {
    const intermediate = input("qaqc", "qaqc_report", "approve", { reportType, state: "submitted" });
    expect(approvalEmailEvent(intermediate)).toMatchObject({ entityType: `${reportType}_report`, action: "approve" });
    expect(approvalEmailEvent({ ...intermediate, record: { reportType, state: "approved" } })).toMatchObject({
      app: "qaqc", entityType: `${reportType}_report`, action: "approved_final", entityId: "record",
    });
  });
  it("classifies only the last Audit Report approval", () => {
    for (const status of ["Pending approval", "Sent back", "Approved"]) {
      const event = input("audit", "audit", "approve_report", { status: JSON.stringify({ reportApproval: { status } }) });
      expect(approvalEmailEvent(event).action).toBe(status === "Approved" ? "approved_final" : "approve_report");
    }
  });
  it("handles legacy/malformed report metadata without inventing approval", () => {
    for (const status of ["Complete", "{", null, undefined]) {
      const event = input("audit", "audit", "approve_report", { status });
      expect(approvalEmailEvent(event)).toEqual(event);
    }
  });
  it("classifies final and legacy single-level CAR acceptance, not intermediate acceptance", () => {
    expect(approvalEmailEvent(input("audit", "corrective_action_report", "accept", { workflowState: "closed" })).action).toBe("approved_final");
    expect(approvalEmailEvent(input("audit", "corrective_action_report", "accept", { workflowState: "submitted" })).action).toBe("accept");
  });
  it("keeps CAR extension approval separate from response approval", () => {
    expect(approvalEmailEvent(input("audit", "corrective_action_report", "approve_extension", { extensionStatus: "approved" })).action).toBe("approved_final_extension");
    expect(approvalEmailEvent(input("audit", "corrective_action_report", "reject_extension", { extensionStatus: "rejected" })).action).toBe("reject_extension");
  });
  it.each([
    input("audit", "audit_programme", "approved_final", {}),
    input("audit", "audit_schedule", "approve", {}),
    input("audit", "audit", "send_back_report", { status: JSON.stringify({ reportApproval: { status: "Approved" } }) }),
    input("qaqc", "qaqc_report", "approve", { reportType: "csat", state: "approved" }),
    input("lessons", "lesson_form", "approve", {}),
  ])("preserves other workflows: $app.$entityType.$action", event => {
    expect(approvalEmailEvent(event)).toEqual(event);
  });
  it("keeps final-stage reports available as event-specific attachments", () => {
    expect(emailReportOptions("audit.audit.approved_final").map(x => x.value)).toEqual(["audit_report_pdf", "audit_report_pptx"]);
    for (const entity of ["monthly_report", "daily_report"])
      expect(emailReportOptions(`qaqc.${entity}.approved_final`).map(x => x.value)).toEqual(["qaqc_report_pdf"]);
    expect(emailReportOptions("audit.corrective_action_report.approved_final")).toEqual([]);
  });
  it("isolates Daily and Monthly event options in their respective workspaces", () => {
    const events = Object.entries(finalApprovalEmailEvents).map(([value, label]) => ({ value, label }));
    expect(eventsForWorkspace(events, "docgov").map(x => x.value)).toEqual(["qaqc.daily_report.approved_final"]);
    expect(eventsForWorkspace(events, "qaqc").map(x => x.value)).toEqual(["qaqc.monthly_report.approved_final"]);
  });
});

describe("Final rule precedence and backward compatibility", () => {
  beforeEach(() => vi.clearAllMocks());
  const finalEvent = input("qaqc", "monthly_report", "approved_final", { reportType: "monthly", state: "approved" });
  const legacy = { id: "legacy", eventType: "qaqc.qaqc_report.approve", enabled: true, recipientMode: "external_email", receiverEmail: "old@example.test", recipientConfig: {} };
  const final = { ...legacy, id: "final", eventType: "qaqc.monthly_report.approved_final", receiverEmail: "final@example.test",
    recipientConfig: { reportAttachment: "qaqc_report_pdf", subjectTemplate: "Approved monthly report" } };
  const databaseFor = (rules: any[]) => ({
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rules }) }) }),
  }) as any;

  it("selects the final rule over an earlier/higher-priority legacy rule without duplicate recipients", async () => {
    const result = await resolveEmailRule(databaseFor([legacy, final]), finalEvent);
    expect(result.rule).toEqual(final);
    expect(result.recipients).toEqual([{ email: "final@example.test", name: undefined }]);
  });
  it("retains existing approval delivery when no final rule is configured", async () => {
    const result = await resolveEmailRule(databaseFor([legacy]), finalEvent);
    expect(result.rule?.id).toBe("legacy");
    expect(result.recipients).toHaveLength(1);
  });
  it("does not fall back around an explicitly disabled final rule", async () => {
    const result = await resolveEmailRule(databaseFor([legacy, { ...final, enabled: false }]), finalEvent);
    expect(result.rule?.id).toBe("final");
    expect(result.recipients).toEqual([]);
  });
  it("preserves actor filters on both final and legacy rules", async () => {
    const result = await resolveEmailRule(databaseFor([{ ...final, createdByUserId: "other" }, legacy]), finalEvent);
    expect(result.rule?.id).toBe("legacy");
  });
  it("does not apply the monthly final rule to a daily report", async () => {
    const result = await resolveEmailRule(databaseFor([final, legacy]), { ...finalEvent, entityType: "daily_report" });
    expect(result.rule?.id).toBe("legacy");
  });
  it("does not dispatch without any matching rule", async () => {
    const result = await resolveEmailRule(databaseFor([]), finalEvent);
    expect(result.recipients).toEqual([]);
  });
});
